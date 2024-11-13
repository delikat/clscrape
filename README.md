# Craigslist Rental Listings Scraper

A Node.js scraper for extracting rental listings data from Craigslist. Uses Scrapfly API for reliable access and JavaScript rendering.

## Features

- Extracts listing details including:
  - Title, price, location
  - Full description
  - Amenities and attributes
  - High-resolution images
  - Geographic coordinates
- Handles JavaScript-rendered content
- Saves data in organized JSON format
- Downloads images in highest available resolution
- Rate limiting and error handling

## Usage

1. Install dependencies:
```bash
npm install
```

2. Set your Scrapfly API key in the script:
```javascript
const SCRAPFLY_KEY = 'your-api-key';
```

3. Run the scraper:
```bash
npm start
```

The scraper will create a `listings` directory containing:
- One subdirectory per listing with:
  - metadata.json (all listing details)
  - High-resolution images
- summary.json with overview of all scraped listings

## Configuration

You can modify these parameters in the script:
- Number of listings to scrape (`maxListings`)
- Search location (modify `searchUrl`)
- Delay between requests
- Image resolution preferences