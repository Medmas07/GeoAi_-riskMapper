# GeoAI Risk Mapper

GeoAI Risk Mapper is a climate risk intelligence platform that helps teams understand **where flood and urban heat risks are highest** and what to do about them.

It is designed for:
- **City and regional planners**
- **Insurance and risk teams**
- **Emergency response agencies**
- **Infrastructure and water managers**
- **Real estate and development teams**

## What it does

The platform combines geospatial data, weather information, street-level imagery, and AI analysis to deliver practical, map-based answers to questions like:

- Where should we prioritize drainage investment?
- Which neighbourhoods are most exposed to heat stress?
- Which properties or districts carry the highest climate risk?
- Where should emergency resources be placed first?

## Business value

GeoAI Risk Mapper is built to support faster decisions with less manual effort.

### Key outcomes
- **Faster planning:** turn risk data into clear decisions in minutes
- **Better prioritization:** focus budget on the highest-risk zones first
- **Improved risk pricing:** support insurance and portfolio screening
- **Climate resilience:** identify areas that need adaptation measures
- **Accessible insights:** present complex geospatial information in simple language

## Main features

- **Flood risk mapping**
- **Urban heat risk mapping**
- **Interactive geospatial dashboard**
- **AI assistant for plain-language explanations**
- **Street-level imagery review**
- **Route and profile tools for operational planning**
- **Business-friendly risk summaries**

## Data sources

The system uses a mix of open and commercially usable geospatial data sources:

- **Open-Meteo** for weather and rainfall data
- **SRTM / OpenTopography** for terrain and elevation
- **Mapillary** for street-level imagery
- **AI vision models** to interpret surface conditions and urban form

## Project structure

- `backend/` — FastAPI service, analysis logic, and data providers
- `frontend/` — Next.js interface and interactive map experience
- `infra/` — database schema and deployment support files
- `docs/` — architecture and supporting documentation
- `GeoAI_RiskMapper_Methodology.tex` — LaTeX methodology brief
- `DEMO_SCRIPT.md` — demo script for presentations and recordings

## Quick start

### Backend

1. Create and activate a Python virtual environment.
2. Install dependencies from `backend/requirements.txt`.
3. Run the API with Uvicorn from the backend folder.

### Frontend

1. Install Node.js dependencies in `frontend/`.
2. Run the development server.
3. Open the app in your browser and select a location to analyze.

## Demo use cases

### 1. Urban planning
Use the flood and heat layers to decide where to place drainage upgrades, green infrastructure, and public services.

### 2. Insurance and risk screening
Use risk scores to support pricing, underwriting, and portfolio review.

### 3. Emergency preparedness
Use the map to identify hotspots before extreme weather events and allocate response resources.

### 4. Development and investment
Screen sites before acquisition or construction to reduce climate exposure.

## Methodology summary

GeoAI Risk Mapper works by combining:
1. **Terrain** — where water is likely to flow
2. **Weather** — how strong the trigger is
3. **Street-level evidence** — what the built environment actually looks like
4. **AI interpretation** — a plain-language summary for decision-makers

This gives a practical risk view that is easy to understand and useful for business, government, and operational teams.

## Notes

- The platform is designed for **decision support**, not as a replacement for engineering-grade studies.
- Final planning, underwriting, or emergency decisions should be validated by qualified experts.
- Data coverage may vary by region depending on imagery availability and source quality.

## License

Add your project license here if applicable.

## Contact

Add your team or project contact details here.
