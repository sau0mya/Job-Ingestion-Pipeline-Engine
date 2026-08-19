const client = require('../client');

/**
 * Validates the raw listing structure.
 * Returns an object indicating validity and validation errors.
 */
function validateListing(listing) {
  const errors = [];
  
  if (!listing || typeof listing !== 'object') {
    return { valid: false, reason: 'Listing is not an object or is null' };
  }

  if (!listing.id) {
    errors.push('missing or empty id');
  }

  if (!listing.position || typeof listing.position !== 'string' || !listing.position.trim()) {
    errors.push('missing or empty position/title');
  }

  if (!listing.company || typeof listing.company !== 'string' || !listing.company.trim()) {
    errors.push('missing or empty company');
  }

  if (!listing.url || typeof listing.url !== 'string' || !listing.url.trim()) {
    errors.push('missing or empty url');
  }

  if (!listing.date || typeof listing.date !== 'string' || !listing.date.trim()) {
    errors.push('missing or empty date');
  }

  if (errors.length > 0) {
    return { valid: false, reason: errors.join(', ') };
  }

  return { valid: true };
}

/**
 * Cleans HTML tags, decodes standard HTML entities, and truncates the listing description.
 */
function cleanDescription(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  // 1. Remove inline formatting tags without introducing spacing
  let text = html.replace(/<\/?(strong|em|b|i|span|a)[^>]*>/gi, '');
  
  // 2. Replace all remaining HTML tags (like paragraph/break blocks) with space
  text = text.replace(/<[^>]*>/g, ' ');
  
  // 3. Resolve HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // 4. Compact extra whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // 5. Truncate to a safe snippet length
  if (text.length > 250) {
    return text.slice(0, 247) + '...';
  }
  return text;
}

/**
 * Fetches listings from RemoteOK and parses them.
 * 
 * @param {object} options Options passed to fetch client
 * @returns {Promise<{ normalized: array, rejected: array }>}
 */
async function fetchAndParseListings(options = {}) {
  const url = options.url || 'https://remoteok.com/api';
  
  const data = await client.fetchWithRetry(url, options);

  if (!Array.isArray(data)) {
    throw new Error('RemoteOK API response is not an array');
  }

  const results = {
    normalized: [],
    rejected: [] // stores details of rejected listings for logging and tracking
  };

  const fetchedAt = new Date().toISOString();

  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    // Filter out the legal notice (it has a 'legal' property, and usually no 'id')
    if (item && (item.legal !== undefined || item.last_updated !== undefined && item.id === undefined)) {
      // Quietly filter out the legal notice without warning log
      continue;
    }

    const validation = validateListing(item);
    
    if (!validation.valid) {
      // Skip the listing, but log a structured warning. Do NOT crash.
      console.warn(`[RemoteOK Source] [Validation Warning] Item at index ${i} failed validation: ${validation.reason}. Raw item preview: ${JSON.stringify(item).slice(0, 150)}...`);
      results.rejected.push({
        index: i,
        raw: item,
        reason: validation.reason
      });
      continue;
    }

    // Normalize representation
    results.normalized.push({
      externalId: String(item.id),
      title: item.position.trim(),
      company: item.company.trim(),
      url: item.url.trim(),
      tags: Array.isArray(item.tags) ? item.tags : [],
      location: item.location ? item.location.trim().replace(/,\s*$/, '') : '', // strip trailing commas from RemoteOK location
      postedAt: item.date,
      source: options.source || 'remoteok', // Allow dynamic overriding of source
      fetchedAt,
      description: cleanDescription(item.description)
    });
  }

  return results;
}

module.exports = {
  fetchAndParseListings,
  validateListing,
  cleanDescription
};
