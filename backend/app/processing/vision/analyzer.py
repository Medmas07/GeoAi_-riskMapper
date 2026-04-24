import httpx
import base64
from dataclasses import dataclass
from typing import Optional
from app.data_providers.imagery.mapillary import MapillaryImage
from app.core.config import settings


@dataclass
class ImageFeatures:
    mapillary_id: str
    lat: float
    lon: float
    vegetation_score: float    # 0-1 (green coverage)
    impervious_score: float    # 0-1 (concrete/asphalt)
    shadow_score: float        # 0-1 (shading intensity)
    standing_water: bool       # detected standing water
    surface_type: str          # road/vegetation/water/building


@dataclass
class VisionSummary:
    image_count: int
    mean_vegetation: float
    mean_impervious: float
    mean_shadow: float
    standing_water_pct: float
    dominant_surface: str
    per_image: list[ImageFeatures]


# Cityscapes label groups for risk-relevant categories
_VEG_LABELS = {"vegetation", "terrain"}
_IMP_LABELS = {"road", "sidewalk", "building", "wall", "fence", "bridge", "tunnel"}
_SKY_LABELS = {"sky"}
_WATER_LABELS = {"water", "river", "sea", "lake", "flood"}


class VisionAnalyzer:
    """
    Analyzes Mapillary images for urban surface features.
    Fallback chain: segformer (HF) → groq vision → mock
    """

    def process(self, images: list[MapillaryImage]) -> VisionSummary:
        if not images:
            return self._empty_summary()

        per_image = []
        for img in images:
            if img.thumb_url:
                per_image.append(self._analyze_image(img))

        if not per_image:
            return self._empty_summary()

        return VisionSummary(
            image_count=len(per_image),
            mean_vegetation=sum(f.vegetation_score for f in per_image) / len(per_image),
            mean_impervious=sum(f.impervious_score for f in per_image) / len(per_image),
            mean_shadow=sum(f.shadow_score for f in per_image) / len(per_image),
            standing_water_pct=sum(1 for f in per_image if f.standing_water) / len(per_image),
            dominant_surface=self._dominant_surface(per_image),
            per_image=per_image,
        )

    def _analyze_image(self, img: MapillaryImage) -> ImageFeatures:
        if settings.CV_MODEL == "segformer":
            return self._segformer_classify(img)
        if settings.CV_MODEL == "groq":
            return self._groq_vision_classify(img)
        if settings.CV_MODEL == "mock":
            return self._mock_features(img)
        return self._clip_classify(img)

    # ── SegFormer (HuggingFace Inference API) ────────────────────────────────

    def _segformer_classify(self, img: MapillaryImage) -> ImageFeatures:
        """
        nvidia/segformer-b0-finetuned-cityscapes-640-640 via HF Inference API.
        Returns pixel-level surface breakdown for accurate risk scoring.
        """
        try:
            import io
            import numpy as np
            from PIL import Image as PILImage

            img_bytes = httpx.get(str(img.thumb_url), timeout=15).content

            hf_resp = httpx.post(
                "https://api-inference.huggingface.co/models/"
                "nvidia/segformer-b0-finetuned-cityscapes-640-640",
                headers={"Authorization": f"Bearer {settings.HF_API_KEY}"},
                content=img_bytes,
                timeout=40,
            )
            hf_resp.raise_for_status()
            segments = hf_resp.json()

            if not isinstance(segments, list) or not segments:
                raise ValueError("Unexpected HF response format")

            # Parse masks — each segment: {label, score, mask (base64 PNG)}
            label_pixels: dict[str, int] = {}
            total_pixels = 0

            for seg in segments:
                label = str(seg.get("label", "")).lower()
                mask_b64 = seg.get("mask", "")
                if not mask_b64:
                    continue
                mask_arr = np.array(
                    PILImage.open(io.BytesIO(base64.b64decode(mask_b64))).convert("L")
                )
                count = int(np.sum(mask_arr > 128))
                label_pixels[label] = label_pixels.get(label, 0) + count
                total_pixels += count

            if total_pixels == 0:
                raise ValueError("Zero pixels parsed from masks")

            def pct(labels: set) -> float:
                return min(sum(label_pixels.get(l, 0) for l in labels) / total_pixels, 1.0)

            veg_score = pct(_VEG_LABELS)
            imp_score = pct(_IMP_LABELS)
            sky_score = pct(_SKY_LABELS)
            water_score = pct(_WATER_LABELS)

            # Shadow proxy: dense impervious + low sky → shadowed street canyon
            shadow_score = float(min(imp_score * (1.0 - sky_score), 1.0))

            # Dominant surface label
            dominant_raw = max(label_pixels, key=label_pixels.__getitem__) if label_pixels else "road"
            surface_map = {
                "vegetation": "vegetation", "terrain": "vegetation",
                "building": "building", "wall": "building",
                "road": "road", "sidewalk": "road",
                "water": "water", "river": "water", "sea": "water",
            }
            surface_type = surface_map.get(dominant_raw, "road")

            return ImageFeatures(
                mapillary_id=img.id,
                lat=img.lat,
                lon=img.lon,
                vegetation_score=veg_score,
                impervious_score=imp_score,
                shadow_score=shadow_score,
                standing_water=water_score > 0.04 or (veg_score < 0.05 and imp_score < 0.35),
                surface_type=surface_type,
            )
        except Exception:
            return self._groq_vision_classify(img)

    # ── Groq vision (llama-3.2-11b-vision) ──────────────────────────────────

    def _groq_vision_classify(self, img: MapillaryImage) -> ImageFeatures:
        """Groq llama-3.2-11b-vision — free tier fallback."""
        try:
            import json as _json

            prompt = (
                "Analyze this street image for urban risk mapping. "
                "Return ONLY valid JSON with these float fields (0.0-1.0): "
                "vegetation_score, impervious_score, shadow_score, "
                "standing_water (1.0 if puddles/flooding else 0.0), "
                "surface_type (road|vegetation|water|building). "
                'Example: {"vegetation_score":0.15,"impervious_score":0.75,'
                '"shadow_score":0.2,"standing_water":0.0,"surface_type":"road"}'
            )

            resp = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                json={
                    "model": "llama-3.2-11b-vision-preview",
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": str(img.thumb_url)}},
                            {"type": "text", "text": prompt},
                        ],
                    }],
                    "max_tokens": 120,
                    "temperature": 0.0,
                },
                timeout=20,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"].strip()
            start, end = content.find("{"), content.rfind("}") + 1
            data = _json.loads(content[start:end])

            return ImageFeatures(
                mapillary_id=img.id,
                lat=img.lat,
                lon=img.lon,
                vegetation_score=float(data.get("vegetation_score", 0.2)),
                impervious_score=float(data.get("impervious_score", 0.5)),
                shadow_score=float(data.get("shadow_score", 0.1)),
                standing_water=float(data.get("standing_water", 0.0)) > 0.5,
                surface_type=str(data.get("surface_type", "road")),
            )
        except Exception:
            return self._mock_features(img)

    # ── CLIP (local HuggingFace) ─────────────────────────────────────────────

    def _clip_classify(self, img: MapillaryImage) -> ImageFeatures:
        """Zero-shot classification using CLIP via HuggingFace (local)."""
        try:
            import torch
            from transformers import CLIPProcessor, CLIPModel
            from PIL import Image
            import io

            model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

            resp = httpx.get(str(img.thumb_url), timeout=15)
            pil_img = Image.open(io.BytesIO(resp.content)).convert("RGB")

            labels = [
                "dense vegetation and trees",
                "concrete road and asphalt",
                "standing water and flooding",
                "building facade",
                "shaded area",
            ]
            inputs = processor(text=labels, images=pil_img, return_tensors="pt", padding=True)
            with torch.no_grad():
                outputs = model(**inputs)
            probs = outputs.logits_per_image.softmax(dim=1).squeeze().tolist()

            return ImageFeatures(
                mapillary_id=img.id,
                lat=img.lat,
                lon=img.lon,
                vegetation_score=probs[0],
                impervious_score=probs[1],
                shadow_score=probs[4],
                standing_water=probs[2] > 0.3,
                surface_type=labels[probs.index(max(probs))].split()[0],
            )
        except Exception:
            return self._mock_features(img)

    # ── Mock ─────────────────────────────────────────────────────────────────

    def _mock_features(self, img: MapillaryImage) -> ImageFeatures:
        import random
        rng = random.Random(hash(img.id))
        return ImageFeatures(
            mapillary_id=img.id,
            lat=img.lat,
            lon=img.lon,
            vegetation_score=rng.uniform(0.1, 0.9),
            impervious_score=rng.uniform(0.1, 0.9),
            shadow_score=rng.uniform(0.0, 0.6),
            standing_water=rng.random() < 0.1,
            surface_type=rng.choice(["road", "vegetation", "building"]),
        )

    def _dominant_surface(self, features: list[ImageFeatures]) -> str:
        from collections import Counter
        return Counter(f.surface_type for f in features).most_common(1)[0][0]

    def _empty_summary(self) -> VisionSummary:
        return VisionSummary(
            image_count=0,
            mean_vegetation=0.0,
            mean_impervious=0.5,
            mean_shadow=0.0,
            standing_water_pct=0.0,
            dominant_surface="unknown",
            per_image=[],
        )
