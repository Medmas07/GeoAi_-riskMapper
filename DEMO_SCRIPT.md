# GeoAI Risk Mapper — Live Demo Script
**Duration:** ~8–10 minutes | For OBS Recording

---

## **SEGMENT 1: OPENING & PROBLEM STATEMENT** _(0:00–0:45)_

**[VISUAL: Title slide with GeoAI logo + "Flood & Urban Heat Risk Intelligence"]**

---

**You say:**

> "Hi, I'm [your name], and I'm going to show you **GeoAI Risk Mapper** — a platform that answers one critical question: *Where are floods and extreme heat going to hit tomorrow?*
>
> Here's the problem: Every year, African cities lose billions to preventable climate disasters. Urban planners don't know where to invest in drainage. Insurance companies misprice climate risk. Governments can't pre-position emergency resources.
>
> Why? Because understanding flood and heat risk requires **satellites, weather data, street-level imagery, and AI** — a combination most cities don't have access to.
>
> Until now."

**[Pause for 2 seconds — let it sink in]**

---

## **SEGMENT 2: LIVE PLATFORM DEMO — QUICK TOUR** _(0:45–2:30)_

**[VISUAL: Navigate to GeoAI platform homepage / dashboard]**

---

**You say:**

> "Let me show you how this works in practice. I'm going to pick a city — let's say **Tunis, Tunisia** — and run a complete climate risk analysis in real-time.
>
> Here's what we're looking at right now:
>
> - **Interactive map** showing the entire city
> - **Two risk layers:** flood risk (blue tones) and heat risk (red/orange tones)
> - **Data is live:** Updated every week from real weather, terrain, and street imagery
>
> Notice the **blue zones** here? These are flood hotspots. Why? Because the terrain is flat, drainage is poor, and 7-day rain averages are high.
>
> And the **red zones**? Those are heat islands — dense urban areas with lots of concrete, few trees, high humidity. Dangerous for vulnerable populations."

**[Click on a HIGH-RISK zone — show the risk score popup]**

---

## **SEGMENT 3: USE CASE 1 — URBAN PLANNER** _(2:30–4:15)_

**[VISUAL: Zoom into a specific neighbourhood; show flood risk details]**

---

**You say:**

> "Let's say I'm **Ahmed**, a city planner in Tunis. I need to decide: *Where should we invest \$2 million in new drainage infrastructure?*
>
> Traditionally, this takes **3–6 months** of consultant reports and guesswork.
>
> With GeoAI? **5 minutes.**
>
> I open the flood risk map. I see that **this neighbourhood here** has:
> - **Score: 78/100 — HIGH RISK**
> - Reason: Flat terrain + low elevation + heavy rainfall in past week + 60% concrete cover
>
> The platform tells me: *'This is a priority zone for drainage investment.'*
>
> I click on [CLICK: stats panel], and it shows me:
> - **Runoff coefficient:** 0.65 (meaning 65% of rain becomes surface water — not absorbed)
> - **Peak flow:** This area would see 200+ mm/hour during intense rainfall
> - **Strategic recommendation:** Redirect investment here, not the politician's preferred zone 5km away
>
> This single insight **saves the city from wasting \$800k on the wrong location.**"

**[Show risk narrative from AI assistant]**

> "And look at this — the AI assistant has already written a plain-language explanation:
>
> *'Flood risk in this zone is driven by three factors: steep runoff from uphill terrain, poor infiltration due to 60% concrete cover, and standing water in monsoon season. Recommended mitigation: green infrastructure retrofit + improved stormwater management.'*
>
> In English. No PhD in hydrology required."

---

## **SEGMENT 4: USE CASE 2 — INSURANCE OFFICER** _(4:15–6:00)_

**[VISUAL: Switch to property-level assessment view / API dashboard]**

---

**You say:**

> "Now let's switch hats. I'm **Fatima**, an insurance underwriter at an African P&C firm. Every day, I get requests to insure properties in flood-prone areas.
>
> My job: *Don't underprice risk. Don't leave money on the table.*
>
> I used to rely on outdated flood maps or consultant opinions. Now? I use GeoAI's API.
>
> Here's a property I'm evaluating — a commercial building at [ADDRESS]. I query the platform:
>
> *'What's the flood risk at this exact location?'*
>
> **Result: 54/100 — MEDIUM RISK**
>
> The API returns:
> - **10-year expected loss:** \$245k (based on historical rainfall + terrain modeling)
> - **Premium I should charge:** \$2,500/year (vs. \$800 if I'd guessed)
> - **Confidence level:** 87% (based on satellite data quality + street imagery coverage)
>
> Now I'm pricing accurately. No more uninsured climate risk in my portfolio."

**[Show heat risk on same property]**

> "And heat risk on the same property: **62/100 — MODERATE-HIGH**
>
> Why? It's in an urban heat island. During heat waves, this district gets 4–6°C hotter than surrounding areas. Liability exposure for outdoor workers + equipment failure in storage.
>
> **Heat premium adjustment: +\$800/year.**
>
> I just recovered revenue across 5,000 properties using automated risk scoring. My CFO is happy."

---

## **SEGMENT 5: USE CASE 3 — EMERGENCY MANAGER** _(6:00–7:30)_

**[VISUAL: Real-time alerts view / hot-spot zones]**

---

**You say:**

> "One more scenario. I'm **Khalid**, head of civil protection in a regional government. Monsoon season is coming. I have limited resources — personnel, sandbags, rescue boats.
>
> Where do I pre-position them?
>
> I open GeoAI and filter for **'zones scoring 70+/100 for flood risk in the past 7 days'**
>
> The platform highlights [SHOW MAP]: Three critical zones.
>
> **Zone A (Downtown):** 92/100 — Recent heavy rainfall + urban drainage collapse + 50,000 residents
> **Zone B (Industrial):** 76/100 — Low elevation + factory zone + few escape routes
> **Zone C (Suburban):** 71/100 — Informal settlement + no drainage + vulnerable population
>
> I allocate:
> - 60% resources to Zone A (highest population + fastest water accumulation)
> - 25% to Zone B (industrial evacuation / environmental protection)
> - 15% to Zone C (community warning system + safe opening of community centers)
>
> **Result:** When the monsoon hits 3 days later, we've already saved lives by being there first.
>
> No more reactive response. **We're predictive now.**

---

## **SEGMENT 6: THE MAGIC BEHIND IT** _(7:30–8:45)_

**[VISUAL: Data sources graphic showing four data streams]**

---

**You say:**

> "You might be wondering: *How is this even possible?*
>
> Here's the secret — we're combining **four independent data sources** that have *never* been integrated before at scale:
>
> **1. Satellite Terrain Data (NASA SRTM)**
> - Global elevation maps at 30m resolution
> - Tells us: Where's the water naturally going to flow?
>
> **2. Real-Time Weather (Open-Meteo)**
> - Hourly precipitation & temperature — 40+ years of history
> - Tells us: How much rain fell? How hot is it?
> - Cost: **\$0** (open data)
>
> **3. Street-Level Imagery (Mapillary)**
> - Millions of georeferenced photos from thousands of cities
> - Captures the *actual* built environment
> - Tells us: How much concrete vs. trees? Standing water visible?
>
> **4. AI Vision (SegFormer — NVIDIA)**
> - Automatically classifies every pixel in street photos
> - Tells us: Exact % impervious cover, vegetation, water
> - **±5% accuracy** (vs. ±20% for satellite alone)
>
> No vendor lock-in. No hidden licensing fees. **Open data + open science.**
>
> All this runs in the cloud in **under 5 minutes**."

---

## **SEGMENT 7: IMPACT & BUSINESS MODEL** _(8:45–9:30)_

**[VISUAL: ROI slide or success metrics]**

---

**You say:**

> "So what's the business case?
>
> **For cities:** \$20k/year subscription. In 6 months, we've saved you \$2M in misdirected infrastructure investment. ROI: **100x.**
>
> **For insurance:** \$0.10–0.50 per property assessment. One large portfolio (5,000 properties)? That's \$2,500–5,000/month in recovered premium accuracy. ROI in the first month.
>
> **For government parametric insurance:** Automatic payout triggers when flood/heat thresholds are crossed. Faster relief. Lower administrative overhead.
>
> **Our Year 1 targets:**
> - 50 cities onboarded
> - 100,000+ risk assessments
> - 2 billion people with baseline hazard maps
> - Cost per analysis: **\$0.05** (including all cloud compute + AI inference)
>
> We're scaling climate risk intelligence **to the scale of the climate crisis itself.**"

---

## **SEGMENT 8: CLOSING / CALL TO ACTION** _(9:30–10:00)_

**[VISUAL: Contact slide + GeoAI logo]**

---

**You say:**

> "In two weeks, I've built a system that would have taken a traditional GIS consultancy **3–6 months and \$300k+**.
>
> Why does this matter?
>
> **Because climate is here.** Floods are hitting harder. Heat waves are longer. Governments and businesses *can't afford* to wait months for risk assessments.
>
> **GeoAI Risk Mapper exists to compress that timeline to 5 minutes.**
>
> We're open to partnerships with:
> - **Cities** looking to build climate resilience roadmaps
> - **Insurance** companies wanting to price climate risk accurately
> - **Governments** needing rapid parametric insurance triggers
> - **Investors** seeing the climate intelligence market as the next multi-billion dollar opportunity
>
> If you're serious about climate adaptation in MENA or Africa, **let's talk.**
>
> Thank you."

**[END]**

---

## **TIMING NOTES**

| Section | Duration | 
|---------|----------|
| Opening | 45 sec |
| Platform Tour | 1:45 |
| Use Case 1 (Planner) | 1:45 |
| Use Case 2 (Insurance) | 1:45 |
| Use Case 3 (Emergency) | 1:30 |
| Data Magic | 1:15 |
| Business | 0:45 |
| Close | 0:30 |
| **TOTAL** | **~10 min** |

---

## **PRODUCTION TIPS FOR OBS RECORDING**

1. **Screen Layout:** Keep map/dashboard visible throughout. Only switch for data graphics when you're talking about the "behind the scenes"
2. **Sound:** Use a lapel mic or USB headset (not laptop speaker)
3. **Pacing:** Slow down on the key differentiators. Let visuals breathe for 2–3 seconds
4. **Transitions:** Zoom in/out of the map to show different zones (feels more cinematic than static)
5. **Demo failures:** If the platform is slow, have a **backup pre-recorded demo** ready as a "video playback"
6. **Talking vs. clicking:** Talk for 30 sec, then click something on screen. Repeat. Don't rush — let the UI speak.

---

## **OPTIONAL: AUDIENCE QUESTIONS TO PREPARE FOR**

- *"Aren't you just using satellite data everyone else has?"*
  → **No — we're combining terrain + weather + street imagery + AI. The combination is unique.**

- *"What happens in winter or dry season?"*
  → **Risk scores drop, but historical data still predicts drought risk, heat stress. Platform is 365-day intelligence, not just monsoon season.**

- *"Can I use this for detailed engineering design?"*
  → **Great question. GeoAI is for screening and strategy. Once you know the hot zones, you hire engineers for meter-level accuracy. We're the **first filter**, not the final design.**

- *"How do you handle informal settlements with no city data?"*
  → **Street imagery covers them. If Mapillary coverage is sparse, we partner with cities to crowdsource drone surveys. Equity-first approach.**

---

**Good luck with the hackathon! 🚀**
