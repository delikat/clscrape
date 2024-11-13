const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const SCRAPFLY_KEY = 'scp-live-1b020badf8fb4fdf9cf0fe9ed038977c';

async function scrapflyRequest(url) {
    const params = new URLSearchParams({
        key: SCRAPFLY_KEY,
        url: url,
        render_js: 'true',
        asp: 'true'
    });

    try {
        const response = await axios.get(`https://api.scrapfly.io/scrape?${params}`);
        return response.data.result.content;
    } catch (error) {
        console.error('Scrapfly API error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw error;
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureDirectoryExists(directory) {
    try {
        await fs.access(directory);
    } catch {
        await fs.mkdir(directory, { recursive: true });
    }
}

async function getListingsFromSearchPage(searchUrl) {
    try {
        console.log(`Fetching search results from: ${searchUrl}`);
        
        // Add initial delay to seem more human-like
        await delay(2000 + Math.random() * 2000);
        
        const html = await scrapflyRequest(searchUrl);
        const $ = cheerio.load(html);
        
        const listings = [];
        $('.cl-static-search-result').each((i, element) => {
            const $element = $(element);
            const $link = $element.find('a');
            const title = $element.find('.title').text().trim();
            const url = $link.attr('href');
            const price = $element.find('.price').text().trim();
            const location = $element.find('.location').text().trim();
            const postId = url ? url.match(/\/(\d+)\.html$/)?.[1] : null;

            if (url && postId) {
                listings.push({
                    postId,
                    url,
                    title,
                    price,
                    location,
                    description: $element.attr('title') || ''  // Get the hover text which often has additional details
                });
            }
        });

        // Save the HTML for debugging
        const debugDir = path.join(__dirname, 'debug');
        await ensureDirectoryExists(debugDir);
        await fs.writeFile(path.join(debugDir, 'search_page.html'), html);
        
        console.log(`Found ${listings.length} listings`);
        return {
            listings,
            totalCount: listings.length,
            html
        };

    } catch (error) {
        console.error('Error fetching search results:', error.message);
        return { listings: [], totalCount: 0, html: '' };
    }
}

async function downloadImage(url, filepath) {
    try {
        // Try highest resolution first (1200x900)
        const highResUrl = url.replace(/\d+x\d+c/, '1200x900');
        const response = await axios.get(highResUrl, {
            responseType: 'arraybuffer'
        });

        await fs.writeFile(filepath, response.data);
        return {
            success: true,
            resolution: '1200x900',
            size: response.data.length
        };
    } catch (error) {
        // Fall back to standard resolution (600x450)
        try {
            const stdResUrl = url.replace(/\d+x\d+c/, '600x450');
            const response = await axios.get(stdResUrl, {
                responseType: 'arraybuffer'
            });

            await fs.writeFile(filepath, response.data);
            return {
                success: true,
                resolution: '600x450',
                size: response.data.length
            };
        } catch (error) {
            console.error(`Failed to download image ${url}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

async function scrapeListing(listingInfo) {
    try {
        console.log(`\nProcessing listing ${listingInfo.postId}: ${listingInfo.title}`);
        
        const html = await scrapflyRequest(listingInfo.url);
        const $ = cheerio.load(html);
        
        const listingDir = path.join(__dirname, 'listings', listingInfo.postId);
        await ensureDirectoryExists(listingDir);

        // Save the raw HTML for debugging
        await fs.writeFile(path.join(listingDir, 'raw.html'), html);

        const listing = {
            ...listingInfo,
            images: [],
            description: $('#postingbody').text().trim()
                .replace('QR Code Link to This Post\n', '')
                .trim(),
            attributes: {},
            mapAddress: $('[data-latitude]').attr('data-latitude') 
                ? {
                    latitude: $('[data-latitude]').attr('data-latitude'),
                    longitude: $('[data-longitude]').attr('data-longitude'),
                    address: $('#map').attr('data-address')
                } 
                : null
        };

        // Extract attributes
        $('.attrgroup').each((i, group) => {
            $(group).find('span').each((j, span) => {
                const text = $(span).text().trim();
                if (text.includes(':')) {
                    const [key, value] = text.split(':').map(s => s.trim());
                    listing.attributes[key] = value;
                } else if (text) {
                    listing.attributes[`attribute${j}`] = text;
                }
            });
        });

        // Download images
        const imagePromises = [];
        $('.gallery img').each((i, el) => {
            const imageUrl = $(el).attr('src');
            if (imageUrl) {
                const imageFilename = `image_${i + 1}.jpg`;
                const imagePath = path.join(listingDir, imageFilename);
                
                const imageInfo = {
                    originalUrl: imageUrl,
                    localPath: imagePath,
                    filename: imageFilename
                };
                listing.images.push(imageInfo);

                imagePromises.push(
                    downloadImage(imageUrl, imagePath)
                        .then(result => {
                            imageInfo.downloadResult = result;
                        })
                );
            }
        });

        // Wait for all images to download
        await Promise.all(imagePromises);

        // Save listing metadata
        const metadataPath = path.join(listingDir, 'metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(listing, null, 2));

        console.log(`Downloaded ${listing.images.length} images`);
        listing.images.forEach(img => {
            if (img.downloadResult?.success) {
                console.log(`  - ${img.filename}: ${img.downloadResult.resolution}, ${(img.downloadResult.size / 1024).toFixed(1)}KB`);
            } else {
                console.log(`  - ${img.filename}: Download failed`);
            }
        });

        return listing;

    } catch (error) {
        console.error(`Error scraping listing ${listingInfo.url}:`, error.message);
        return null;
    }
}

async function scrapeMultipleListings(searchUrl, maxListings = 10) {
    try {
        const searchResults = await getListingsFromSearchPage(searchUrl);
        const listingsToProcess = searchResults.listings.slice(0, maxListings);
        
        console.log(`\nProcessing ${listingsToProcess.length} listings out of ${searchResults.totalCount} total results`);
        
        const results = [];
        for (const listingInfo of listingsToProcess) {
            const listing = await scrapeListing(listingInfo);
            if (listing) {
                results.push(listing);
            }
            
            // Add random delay between listings (3-7 seconds)
            if (listingInfo !== listingsToProcess[listingsToProcess.length - 1]) {
                const delayTime = 3000 + Math.random() * 4000;
                console.log(`Waiting ${(delayTime/1000).toFixed(1)} seconds before next listing...`);
                await delay(delayTime);
            }
        }

        // Save summary of all listings
        const summaryPath = path.join(__dirname, 'listings', 'summary.json');
        await fs.writeFile(summaryPath, JSON.stringify({
            searchUrl,
            scrapedAt: new Date().toISOString(),
            totalListings: searchResults.totalCount,
            processedListings: results.length,
            listings: results
        }, null, 2));

        return results;

    } catch (error) {
        console.error('Error in scraping process:', error.message);
        return [];
    }
}

// Start scraping with the SF apartments search URL
const searchUrl = 'https://sfbay.craigslist.org/search/sfc/apa';

console.log('Starting multi-listing scraper...');
scrapeMultipleListings(searchUrl, 5)  // Start with 5 listings as a test
    .then(listings => {
        console.log('\nScraping completed!');
        console.log(`Successfully processed ${listings.length} listings`);
    })
    .catch(error => {
        console.error('Error running scraper:', error.message);
    });