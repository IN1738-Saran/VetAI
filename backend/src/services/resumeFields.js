// ============================================================================
// RESUME FIELD EXTRACTION  (NEW — OCR integration)
// ----------------------------------------------------------------------------
// Azure's prebuilt-layout model returns text, tables and key/value pairs — it
// does not return résumé *semantics*. This module adds that layer on top: it
// segments the document into the usual résumé sections and then mines each
// section for the fields the Generate Score page displays.
//
// This is a direct port of the rule-based extractor from the standalone
// "Azure AI Document Intelligence" evaluation app, so the two projects report
// the same fields for the same document.
//
// Everything here is deliberately rule-based (regex + curated vocabularies) so
// the behaviour is inspectable and cheap — no model call, no added latency.
//
// Contract: scalar fields are `string` (empty string when not found), list
// fields are `string[]` (empty array when not found). The UI renders any empty
// value as "Not Found". This module NEVER throws — a document that is not a
// résumé simply yields empty values.
// ============================================================================

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

// Canonical section -> pattern that can introduce it.
const SECTION_PATTERNS = [
    ['summary', String.raw`(?:professional\s+)?(?:summary|profile|objective|about\s+me|career\s+objective|overview)`],
    ['experience', String.raw`(?:work\s+|professional\s+|employment\s+|relevant\s+)?(?:experience|history|employment)`],
    ['education', String.raw`education(?:al\s+background|al\s+qualifications?)?|academic(?:\s+background|\s+qualifications?)?|qualifications?`],
    ['technical_skills', String.raw`technical\s+skills?|technical\s+expertise|technical\s+proficienc(?:y|ies)|core\s+competenc(?:y|ies)|tech\s+stack`],
    ['soft_skills', String.raw`soft\s+skills?|interpersonal\s+skills?|personal\s+skills?`],
    ['skills', String.raw`skills?(?:\s*(?:&|and)\s*(?:abilities|expertise|tools))?|expertise|proficienc(?:y|ies)|competenc(?:y|ies)`],
    ['certifications', String.raw`certifications?|certificates?|licenses?(?:\s*(?:&|and)\s*certifications?)?|credentials?`],
    ['projects', String.raw`(?:key\s+|academic\s+|personal\s+|selected\s+)?projects?|portfolio`],
    ['languages', String.raw`languages?(?:\s+known)?|linguistic\s+skills?`],
    ['awards', String.raw`awards?|achievements?|honou?rs?|accomplishments?`],
    ['publications', String.raw`publications?|papers?|research`],
    ['interests', String.raw`interests?|hobbies|activities`],
    ['references', String.raw`references?`],
    ['contact', String.raw`contact(?:\s+(?:info|information|details))?|personal\s+(?:details|information)`],
];

// Two details here are load-bearing, and both mirror the reference implementation:
//
//  * the pattern is interpolated WITHOUT a wrapping group, so each alternation
//    binds loosely — the leading anchor applies only to the first alternative and
//    the trailing one only to the last. That is what lets a decorated heading
//    such as "CERTIFICATIONS & CONTINUOUS LEARNING" still be recognised;
//  * the `y` (sticky) flag reproduces Python's `re.match`, which requires the
//    match to START at position 0. Without it JavaScript would search the whole
//    line, and any résumé line merely CONTAINING a bare alternative — "Google
//    Certified … Certificate" contains "certificate" — would be mistaken for a
//    section heading and silently swallow the lines beneath it.
const COMPILED_SECTIONS = SECTION_PATTERNS.map(([name, pattern]) => [
    name,
    new RegExp(String.raw`^\s*(?:\d+[.)]\s*)?${pattern}\s*:?\s*$`, 'iy'),
]);

/** Python's `regex.match(text)` — the match must start at position 0. */
function matchesAtStart(stickyRegex, text) {
    stickyRegex.lastIndex = 0;
    return stickyRegex.test(text);
}

// Job-title building blocks, used to spot designations and the current title.
const TITLE_KEYWORDS = new Set([
    'engineer', 'developer', 'architect', 'analyst', 'manager', 'consultant',
    'specialist', 'administrator', 'designer', 'scientist', 'programmer',
    'lead', 'director', 'officer', 'president', 'head', 'coordinator',
    'supervisor', 'technician', 'strategist', 'researcher', 'associate',
    'intern', 'trainee', 'executive', 'advisor', 'evangelist', 'owner',
    'recruiter', 'accountant', 'auditor', 'attorney', 'nurse', 'teacher',
    'professor', 'editor', 'writer', 'marketer', 'salesperson', 'founder',
    'cto', 'ceo', 'cfo', 'coo', 'cio', 'vp', 'sre', 'devops', 'qa',
]);

const TITLE_MODIFIERS = new Set([
    'senior', 'junior', 'sr', 'jr', 'principal', 'staff', 'chief', 'assistant',
    'associate', 'lead', 'head', 'deputy', 'vice', 'full', 'stack', 'front',
    'back', 'end', 'software', 'data', 'cloud', 'systems', 'system', 'product',
    'project', 'program', 'technical', 'solution', 'solutions', 'business',
    'security', 'network', 'database', 'machine', 'learning', 'ai', 'ml',
    'mobile', 'web', 'platform', 'site', 'reliability', 'quality', 'test',
    'automation', 'research', 'human', 'resources', 'hr', 'finance', 'sales',
    'marketing', 'operations', 'graphic', 'ux', 'ui', 'digital', 'of', 'and',
    '&', 'i', 'ii', 'iii', 'iv',
]);

// Tokens that mark an organisation name.
const COMPANY_SUFFIXES = new Set([
    'inc', 'inc.', 'llc', 'l.l.c', 'ltd', 'ltd.', 'limited', 'corp', 'corp.',
    'corporation', 'co', 'co.', 'company', 'gmbh', 'plc', 'llp', 'pvt', 'pvt.',
    'private', 'technologies', 'technology', 'tech', 'solutions', 'systems',
    'software', 'labs', 'laboratories', 'group', 'holdings', 'consulting',
    'consultancy', 'services', 'partners', 'associates', 'ventures', 'digital',
    'global', 'international', 'industries', 'enterprises', 'networks',
    'communications', 'media', 'bank', 'capital', 'studios', 'agency', 'ag',
    'sa', 'bv', 'nv', 'oy', 'ab', 'as', 'srl', 'spa', 'sdn', 'bhd',
]);

const EDUCATION_KEYWORDS = new Set([
    'university', 'college', 'institute', 'school', 'academy', 'polytechnic',
    'bachelor', 'bachelors', 'master', 'masters', 'doctorate', 'phd', 'ph.d',
    'b.tech', 'btech', 'b.e', 'be', 'b.sc', 'bsc', 'b.s', 'bs', 'b.a', 'ba',
    'b.com', 'bcom', 'bca', 'm.tech', 'mtech', 'm.e', 'm.sc', 'msc', 'm.s',
    'ms', 'm.a', 'ma', 'mba', 'mca', 'm.com', 'mcom', 'diploma', 'hsc', 'ssc',
    'degree', 'gpa', 'cgpa', 'graduated', 'graduation', '12th', '10th',
]);

const CERTIFICATION_HINTS = [
    'certified', 'certificate', 'certification', 'credential', 'licensed',
    'aws', 'azure', 'gcp', 'google cloud', 'microsoft', 'oracle', 'cisco',
    'comptia', 'pmp', 'prince2', 'scrum', 'csm', 'safe', 'itil', 'cissp',
    'ceh', 'cka', 'ckad', 'terraform', 'kubernetes', 'salesforce', 'tableau',
    'six sigma', 'togaf', 'cpa', 'cfa', 'frm',
];

const SOFT_SKILLS = new Set([
    'communication', 'verbal communication', 'written communication',
    'leadership', 'teamwork', 'team work', 'team player', 'collaboration',
    'problem solving', 'problem-solving', 'critical thinking', 'creativity',
    'creative thinking', 'adaptability', 'flexibility', 'time management',
    'organization', 'organisational skills', 'organizational skills',
    'interpersonal skills', 'interpersonal', 'presentation', 'presentation skills',
    'public speaking', 'negotiation', 'conflict resolution', 'decision making',
    'decision-making', 'analytical thinking', 'attention to detail',
    'detail oriented', 'detail-oriented', 'work ethic', 'self motivated',
    'self-motivated', 'mentoring', 'coaching', 'empathy', 'active listening',
    'emotional intelligence', 'multitasking', 'multi-tasking', 'customer service',
    'stakeholder management', 'facilitation', 'accountability', 'initiative',
    'patience', 'resilience', 'curiosity', 'ownership', 'collaborative',
    'cross functional collaboration', 'cross-functional collaboration',
    'people management', 'strategic thinking', 'planning', 'delegation',
]);

const KNOWN_LANGUAGES = new Set([
    'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch',
    'russian', 'polish', 'swedish', 'norwegian', 'danish', 'finnish', 'greek',
    'turkish', 'arabic', 'hebrew', 'persian', 'farsi', 'urdu', 'hindi',
    'bengali', 'punjabi', 'gujarati', 'marathi', 'tamil', 'telugu', 'kannada',
    'malayalam', 'odia', 'assamese', 'sanskrit', 'nepali', 'sinhala',
    'mandarin', 'cantonese', 'chinese', 'japanese', 'korean', 'vietnamese',
    'thai', 'indonesian', 'malay', 'filipino', 'tagalog', 'burmese', 'khmer',
    'swahili', 'zulu', 'afrikaans', 'amharic', 'yoruba', 'igbo', 'hausa',
    'ukrainian', 'czech', 'slovak', 'hungarian', 'romanian', 'bulgarian',
    'serbian', 'croatian', 'bosnian', 'slovenian', 'albanian', 'lithuanian',
    'latvian', 'estonian', 'icelandic', 'irish', 'welsh', 'catalan', 'basque',
]);

const LANGUAGE_PROFICIENCY = new Set([
    'native', 'fluent', 'bilingual', 'professional', 'conversational', 'basic',
    'intermediate', 'advanced', 'beginner', 'elementary', 'proficient',
    'mother tongue', 'working proficiency', 'limited', 'full', 'c1', 'c2',
    'b1', 'b2', 'a1', 'a2',
]);

// Well-known cities, used to recognise a location that carries no region and
// sits on a line of its own ("Chennai"), where no structural signal exists.
// Necessarily incomplete — it makes confident matches, and `loneHeaderPlace`
// is the fallback for everywhere not listed.
const KNOWN_CITIES = new Set([
    // India
    'mumbai', 'navi mumbai', 'thane', 'delhi', 'new delhi', 'noida', 'greater noida',
    'gurgaon', 'gurugram', 'faridabad', 'ghaziabad', 'bengaluru', 'bangalore',
    'hyderabad', 'secunderabad', 'chennai', 'kolkata', 'howrah', 'pune',
    'pimpri chinchwad', 'ahmedabad', 'gandhinagar', 'surat', 'vadodara', 'rajkot',
    'bhavnagar', 'jamnagar', 'jaipur', 'jodhpur', 'udaipur', 'kota', 'ajmer',
    'bikaner', 'lucknow', 'kanpur', 'varanasi', 'agra', 'meerut', 'prayagraj',
    'allahabad', 'bareilly', 'aligarh', 'gorakhpur', 'saharanpur', 'firozabad',
    'jhansi', 'nagpur', 'nashik', 'aurangabad', 'solapur', 'kolhapur', 'amravati',
    'nanded', 'sangli', 'indore', 'bhopal', 'jabalpur', 'gwalior', 'ujjain',
    'raipur', 'bhilai', 'bilaspur', 'patna', 'gaya', 'muzaffarpur', 'ranchi',
    'jamshedpur', 'dhanbad', 'bokaro', 'bhubaneswar', 'cuttack', 'rourkela',
    'guwahati', 'shillong', 'imphal', 'agartala', 'siliguri', 'durgapur',
    'asansol', 'chandigarh', 'ludhiana', 'amritsar', 'jalandhar', 'patiala',
    'mohali', 'panchkula', 'ambala', 'karnal', 'panipat', 'rohtak', 'hisar',
    'dehradun', 'haridwar', 'rishikesh', 'srinagar', 'jammu', 'shimla',
    'visakhapatnam', 'vizag', 'vijayawada', 'guntur', 'nellore', 'tirupati',
    'rajahmundry', 'kakinada', 'warangal', 'karimnagar', 'nizamabad',
    'coimbatore', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'erode',
    'tirunelveli', 'vellore', 'thanjavur', 'dindigul', 'tiruppur', 'hosur',
    'karur', 'namakkal', 'cuddalore', 'kanchipuram', 'tambaram', 'ambattur',
    'avadi', 'chengalpattu', 'puducherry', 'pondicherry', 'kochi', 'cochin',
    'ernakulam', 'thiruvananthapuram', 'trivandrum', 'kozhikode', 'calicut',
    'thrissur', 'kollam', 'kannur', 'kottayam', 'palakkad', 'alappuzha',
    'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'dharwad', 'belgaum',
    'belagavi', 'davanagere', 'shivamogga', 'tumkur', 'gulbarga', 'kalaburagi',
    'bijapur', 'bellary', 'goa', 'panaji', 'vasco da gama', 'margao',
    // Rest of the world
    'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh',
    'bristol', 'cardiff', 'belfast', 'dublin', 'cork', 'paris', 'lyon',
    'marseille', 'toulouse', 'berlin', 'munich', 'hamburg', 'frankfurt',
    'cologne', 'stuttgart', 'dusseldorf', 'amsterdam', 'rotterdam', 'the hague',
    'utrecht', 'brussels', 'antwerp', 'zurich', 'geneva', 'basel', 'bern',
    'vienna', 'madrid', 'barcelona', 'valencia', 'seville', 'lisbon', 'porto',
    'rome', 'milan', 'turin', 'naples', 'florence', 'stockholm', 'gothenburg',
    'oslo', 'copenhagen', 'helsinki', 'reykjavik', 'warsaw', 'krakow', 'prague',
    'budapest', 'bucharest', 'sofia', 'athens', 'istanbul', 'ankara', 'moscow',
    'saint petersburg', 'kyiv', 'kiev', 'minsk', 'riga', 'vilnius', 'tallinn',
    'dubai', 'abu dhabi', 'sharjah', 'doha', 'riyadh', 'jeddah', 'dammam',
    'kuwait city', 'manama', 'muscat', 'tel aviv', 'jerusalem', 'haifa',
    'cairo', 'alexandria', 'casablanca', 'tunis', 'johannesburg', 'cape town',
    'durban', 'pretoria', 'nairobi', 'lagos', 'abuja', 'accra', 'addis ababa',
    'new york', 'brooklyn', 'manhattan', 'jersey city', 'boston', 'cambridge',
    'philadelphia', 'washington', 'arlington', 'baltimore', 'atlanta',
    'charlotte', 'raleigh', 'miami', 'orlando', 'tampa', 'nashville',
    'chicago', 'detroit', 'minneapolis', 'columbus', 'cleveland', 'indianapolis',
    'milwaukee', 'kansas city', 'st louis', 'dallas', 'austin', 'houston',
    'san antonio', 'denver', 'phoenix', 'scottsdale', 'salt lake city',
    'las vegas', 'los angeles', 'san diego', 'san francisco', 'san jose',
    'sunnyvale', 'santa clara', 'mountain view', 'palo alto', 'irvine',
    'seattle', 'bellevue', 'redmond', 'portland', 'toronto', 'mississauga',
    'brampton', 'ottawa', 'montreal', 'quebec city', 'vancouver', 'surrey',
    'calgary', 'edmonton', 'winnipeg', 'halifax', 'waterloo', 'mexico city',
    'guadalajara', 'monterrey', 'sao paulo', 'rio de janeiro', 'brasilia',
    'buenos aires', 'santiago', 'bogota', 'medellin', 'lima', 'quito',
    'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'canberra',
    'auckland', 'wellington', 'christchurch', 'singapore', 'hong kong',
    'macau', 'tokyo', 'osaka', 'kyoto', 'yokohama', 'nagoya', 'seoul', 'busan',
    'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'chengdu', 'hangzhou',
    'taipei', 'bangkok', 'chiang mai', 'jakarta', 'bandung', 'surabaya',
    'kuala lumpur', 'penang', 'johor bahru', 'manila', 'cebu', 'makati',
    'ho chi minh city', 'hanoi', 'da nang', 'colombo', 'kandy', 'dhaka',
    'chittagong', 'kathmandu', 'karachi', 'lahore', 'islamabad', 'rawalpindi',
]);

// Domains that are never a personal portfolio.
const NON_PORTFOLIO_DOMAINS = new Set([
    'linkedin.com', 'github.com', 'gitlab.com', 'bitbucket.org', 'twitter.com',
    'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'medium.com',
    'stackoverflow.com', 'leetcode.com', 'hackerrank.com', 'kaggle.com',
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'google.com',
    'w3.org', 'schema.org', 'example.com',
]);

const PORTFOLIO_HINTS = ['portfolio', 'about', 'me.', '.me', '.dev', '.io', 'personal', 'blog', 'site'];

const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const BULLET_CHARS = '•▪◦‣·-–—*»>✓✔●○■□';

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------
// Two variants are kept where a pattern is used both to test a string and to
// enumerate every match: JavaScript's `g` flag carries mutable `lastIndex`
// state, so a shared global regex would silently skip matches between calls.

const RE_EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const RE_EMAIL_G = new RegExp(RE_EMAIL.source, 'g');

const RE_PHONE = new RegExp(
    String.raw`(?<![\w/])` +
    String.raw`(?:\+?\d{1,3}[\s.\-]?)?` +          // optional country code
    String.raw`(?:\(\d{2,4}\)[\s.\-]?)?` +         // optional area code in brackets
    String.raw`(?:` +
    String.raw`\d{2,5}(?:[\s.\-]\d{2,5}){1,4}` +   //   grouped: "98765 43210", "415-555-0134"
    String.raw`|\d{7,15}` +                        //   unbroken: "8531889405"
    String.raw`)` +
    String.raw`(?![\w/])`
);
const RE_PHONE_G = new RegExp(RE_PHONE.source, 'g');

const RE_URL = /\b(?:https?:\/\/|www\.)[^\s<>"'\)\],;]+/i;
const RE_URL_G = new RegExp(RE_URL.source, 'gi');

const RE_BARE_DOMAIN = /\b(?!\d)[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.(?:com|net|org|io|dev|me|co|ai|app|tech|xyz|site|page|blog|info|in|uk|us|ca|de|fr|au)\b(?:\/[^\s<>"'\)\],;]*)?/i;
const RE_BARE_DOMAIN_G = new RegExp(RE_BARE_DOMAIN.source, 'gi');

const RE_LINKEDIN = /(?:https?:\/\/)?(?:[\w\-]+\.)?linkedin\.com\/(?:in|pub|profile)\/[\w\-%.]+\/?/i;
const RE_GITHUB_G = /(?:https?:\/\/)?(?:www\.)?github\.com\/(?!gist\b)[\w\-.]+\/?/gi;

const RE_YEARS_BEFORE = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,45}?\bexperience\b/gi;
const RE_YEARS_AFTER = /\bexperience\b[^.\n]{0,45}?(?:of\s+)?(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/gi;
const RE_YEARS_PLUS = /(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/gi;

const MONTH_ALT = Object.keys(MONTHS).join('|');
const RE_DATE_RANGE_SOURCE =
    String.raw`(?:(?<m1>${MONTH_ALT})[a-z]*\.?\s+)?(?<y1>(?:19|20)\d{2})` +
    String.raw`\s*(?:-|–|—|to|until|through)\s*` +
    String.raw`(?:(?:(?<m2>${MONTH_ALT})[a-z]*\.?\s+)?(?<y2>(?:19|20)\d{2})|(?<now>present|current|now|to\s*date|ongoing))`;
const RE_DATE_RANGE = new RegExp(RE_DATE_RANGE_SOURCE, 'i');
const RE_DATE_RANGE_G = new RegExp(RE_DATE_RANGE_SOURCE, 'gi');

const RE_LABEL = {
    name: /^\s*(?:full\s+)?name\s*[:\-]\s*(.+)$/i,
    location: /^\s*(?:current\s+)?(?:location|address|city|based\s+in|residence)\s*[:\-]\s*(.+)$/i,
    title: /^\s*(?:current\s+)?(?:job\s+)?(?:title|designation|role|position)\s*[:\-]\s*(.+)$/i,
    experience: /^\s*(?:total\s+)?(?:years?\s+of\s+)?experience\s*[:\-]\s*(.+)$/i,
};

// A phone label at the start of a *fragment*, so it is found mid-line too:
// "Hyderabad | Ph: +91-... | Gmail: ..." puts the label in the second fragment.
const RE_PHONE_LABEL = /^\s*(?:ph|phone|mobile|mob|cell|tel(?:ephone)?|contact|whatsapp)\.?(?:\s*(?:no\.?|number|#))?\s*[:\-]\s*(.+)$/i;

// Splits a contact line into its parts.
const RE_FRAGMENT_SPLIT = /\s*[|•·]\s*/;

// Leading glyph noise. Modern résumé templates decorate contact details with
// icon fonts, and those glyphs come back from OCR as stray ASCII or emoji
// ("(pin) Chennai" -> "! Chennai", "(link) Profile" -> "@ Profile"), which
// breaks any pattern anchored to the start of the text. `+` is always kept, and
// `(` is kept only when it opens a number — "(044) 2345 6789" is a phone, while
// "() Chennai" is just a bracketed icon that failed to render.
const RE_LEADING_NOISE = /^(?:[^\p{L}\p{N}_(+]|\((?!\s*\d))+/u;

// "Springfield, IL 62704" / "Bengaluru, India" / "London, United Kingdom"
const RE_CITY_REGION = /^[A-Z][A-Za-z.'\-]+(?:[ ][A-Z][A-Za-z.'\-]+){0,2},\s*(?:[A-Z]{2}|[A-Z][A-Za-z.'\-]+(?:[ ][A-Z][A-Za-z.'\-]+){0,2})(?:,\s*[A-Z][A-Za-z.'\-]+(?:[ ][A-Z][A-Za-z.'\-]+){0,2})?(?:\s+\d{4,6}(?:-\d{4})?)?$/;

const RE_NOISE_LINE = /^\s*(?:resume|r[eé]sum[eé]|curriculum\s+vitae|cv|profile|page\s*\d+)\s*$/i;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Every match of a global regex, with `lastIndex` reset so reuse is safe. */
function allMatches(regexG, text) {
    regexG.lastIndex = 0;
    return [...String(text).matchAll(regexG)];
}

/** `String.split` limited to one split, keeping the remainder intact. */
function splitOnce(text, regex) {
    const match = new RegExp(regex.source, regex.flags.replace('g', '')).exec(text);
    if (!match) return [text];
    return [text.slice(0, match.index), text.slice(match.index + match[0].length)];
}

/** Trim any of `chars` from both ends of `value`. */
function stripChars(value, chars) {
    let start = 0;
    let end = value.length;
    while (start < end && chars.includes(value[start])) start++;
    while (end > start && chars.includes(value[end - 1])) end--;
    return value.slice(start, end);
}

/** Trim any of `chars` from the start of `value`. */
function lstripChars(value, chars) {
    let start = 0;
    while (start < value.length && chars.includes(value[start])) start++;
    return value.slice(start);
}

/** Strip bullets, stray separators and collapse internal whitespace. */
function cleanLine(line) {
    let cleaned = lstripChars(String(line).trim(), BULLET_CHARS).trim();
    cleaned = cleaned.replace(/\s+/g, ' ');
    return stripChars(cleaned, ' \t|;');
}

/** Non-empty, whitespace-normalised lines. */
function splitLines(text) {
    return String(text)
        .split(/\r\n|\r|\n/)
        .map((raw) => raw.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

/** Order-preserving, case-insensitive de-duplication. */
function dedupe(items, limit = null) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
        const value = String(item).trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(value);
        if (limit && output.length >= limit) break;
    }
    return output;
}

/** Prose (a description) rather than a heading or list entry. */
function looksLikeSentence(line) {
    return line.length > 90 || (line.split(' ').length - 1) > 14;
}

function tokens(text) {
    return String(text).toLowerCase().match(/[A-Za-z][A-Za-z.+#/&\-]*/g) || [];
}

/** True when any token of `text` appears in `vocabulary`. */
function tokensIntersect(text, ...vocabularies) {
    for (const token of tokens(text)) {
        for (const vocabulary of vocabularies) {
            if (vocabulary.has(token)) return true;
        }
    }
    return false;
}

/** Remove decorative leading icon glyphs / punctuation from a fragment. */
function stripGlyphNoise(value) {
    return value.replace(RE_LEADING_NOISE, '').trim();
}

function digitsOnly(value) {
    return String(value).replace(/\D/g, '');
}

// Python's `str[:1].isupper()` / `str.isupper()`. Plain `w === w.toUpperCase()`
// would be true for digits and punctuation too, which would let "2019" or "-"
// pass as a capitalised word.
function startsUpper(word) {
    return /^\p{Lu}/u.test(word || '');
}

function isAllUpper(word) {
    return /\p{L}/u.test(word || '') && word === word.toUpperCase();
}

// ---------------------------------------------------------------------------
// Section segmentation
// ---------------------------------------------------------------------------

/**
 * Return the canonical section name when `line` is a section heading.
 *
 * A heading is short, contains no contact details, and matches one of the known
 * section vocabularies exactly (ignoring numbering and a trailing colon).
 */
function matchSectionHeader(line) {
    const candidate = stripChars(String(line).trim(), BULLET_CHARS).trim();
    if (!candidate || candidate.length > 60) return null;
    if (RE_EMAIL.test(candidate) || RE_URL.test(candidate)) return null;
    // A heading rarely ends in a sentence or carries mid-line punctuation.
    if (/[.,;]$/.test(candidate) || (candidate.split(',').length - 1) > 1) return null;

    for (const [name, pattern] of COMPILED_SECTIONS) {
        if (matchesAtStart(pattern, candidate)) return name;
    }
    return null;
}

/**
 * Split résumé lines into `{ sectionName: [lines] }`.
 *
 * Content appearing before the first recognised heading is stored under
 * "header" — that block holds the name and contact details on almost every
 * résumé, so it is treated as its own pseudo-section.
 */
function segmentSections(lines) {
    const sections = { header: [] };
    let current = 'header';

    for (const line of lines) {
        const section = matchSectionHeader(line);
        if (section) {
            current = section;
            if (!sections[current]) sections[current] = [];
            continue;
        }
        if (!sections[current]) sections[current] = [];
        sections[current].push(line);
    }

    return sections;
}

/** Concatenated lines of the named sections. */
function sectionText(sections, ...names) {
    const collected = [];
    for (const name of names) collected.push(...(sections[name] || []));
    return collected;
}

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

function extractEmail(text) {
    for (const match of allMatches(RE_EMAIL_G, text)) {
        const email = stripChars(match[0], '.,;:');
        // Reject image/file names that happen to contain '@'.
        if (!/\.(png|jpg|jpeg|gif|pdf)$/i.test(email)) return email;
    }
    return '';
}

/**
 * Pick the most plausible phone number.
 *
 * Order of preference:
 *   1. an explicitly labelled line ("Phone : 8531889405", "Mobile - +91 ...");
 *   2. a number on a line that mentions a phone keyword;
 *   3. the first plausible number near the top of the document.
 */
function extractPhone(text, lines) {
    // 1. An explicit "Phone:" / "Ph:" label is the strongest possible signal,
    //    and the value may be formatted in a way the general pattern misses.
    //    Labels often sit mid-line, so search each fragment of a contact line.
    for (const line of lines.slice(0, 40)) {
        for (const fragment of line.split(RE_FRAGMENT_SPLIT)) {
            const match = RE_PHONE_LABEL.exec(fragment);
            if (!match) continue;
            const value = cleanLine(match[1]);
            // The fragment may still run on into other details; prefer the
            // first number-shaped run inside it when there is one.
            const inner = RE_PHONE.exec(value);
            const candidate = stripChars(inner ? inner[0] : value, ' -.|');
            // Accept from 7 digits: a labelled value is unambiguous, and a
            // partly-misread number is still worth surfacing so the problem is
            // visible rather than silently reported as "Not Found".
            const digitCount = digitsOnly(candidate).length;
            if (digitCount >= 7 && digitCount <= 15 && candidate.length <= 40) return candidate;
        }
    }

    const labelled = [];
    const unlabelled = [];

    lines.forEach((line, index) => {
        const lowered = line.toLowerCase();
        const hasLabel = /\b(ph|phone|mobile|mob|tel|telephone|cell|contact|whatsapp)\b/.test(lowered);
        // Date ranges and money are the usual false positives.
        if (/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present)/.test(lowered)) return;

        for (const match of allMatches(RE_PHONE_G, line)) {
            const candidate = stripChars(match[0], ' -.');
            const digitCount = digitsOnly(candidate).length;
            if (digitCount < 10 || digitCount > 15) continue;
            const separators = (candidate.match(/[ \-.]/g) || []).length;
            if (separators === 0 && digitCount > 13) continue; // long unbroken run — more likely an ID
            if (hasLabel) labelled.push(candidate);
            else if (index < 20) unlabelled.push(candidate);
        }
    });

    for (const pool of [labelled, unlabelled]) {
        if (pool.length) return dedupe(pool)[0];
    }
    return '';
}

function normaliseUrl(url) {
    let cleaned = stripChars(url, '.,;:)/');
    if (!/^https?:\/\//i.test(cleaned)) cleaned = 'https://' + lstripChars(cleaned, '/');
    return cleaned;
}

function extractLinkedin(text) {
    const match = RE_LINKEDIN.exec(text);
    return match ? normaliseUrl(match[0]) : '';
}

function extractGithub(text) {
    for (const match of allMatches(RE_GITHUB_G, text)) {
        const url = normaliseUrl(match[0]);
        // Skip a bare "github.com" with no user segment.
        if (/github\.com\/[\w\-.]+/i.test(url)) return url;
    }
    return '';
}

/** First URL that is neither a known social network nor the email domain. */
function extractPortfolio(text, email) {
    const emailDomain = email ? email.split('@').pop().toLowerCase() : '';
    const candidates = [];

    const matches = [...allMatches(RE_URL_G, text), ...allMatches(RE_BARE_DOMAIN_G, text)];
    for (const match of matches) {
        const raw = stripChars(match[0], '.,;:');
        let host = raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
        if (host.startsWith('www.')) host = host.slice(4);
        if (!host || !host.includes('.')) continue;
        if (NON_PORTFOLIO_DOMAINS.has(host)) continue;
        if ([...NON_PORTFOLIO_DOMAINS].some((domain) => host.endsWith('.' + domain))) continue;
        if (emailDomain && host === emailDomain) continue;
        candidates.push(normaliseUrl(raw));
    }

    if (!candidates.length) return '';

    // A URL that reads like a personal site wins over an arbitrary link.
    const ranked = dedupe(candidates)
        .map((url, index) => ({
            url,
            rank: PORTFOLIO_HINTS.some((hint) => url.toLowerCase().includes(hint)) ? 0 : 1,
            index,
        }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index);

    return ranked[0].url;
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

const NAME_PARTICLES = new Set(['van', 'von', 'de', 'del', 'della', 'da', 'di', 'bin', 'al', 'la', 'le']);

/** True when a line looks like a person's name rather than anything else. */
function isNameLike(line) {
    if (line.length < 2 || line.length > 60) return false;
    if (RE_EMAIL.test(line) || RE_URL.test(line) || RE_BARE_DOMAIN.test(line)) return false;
    if (/\d/.test(line) || RE_NOISE_LINE.test(line)) return false;
    if (['|', '•', '@', ',', ':', ';', '/'].some((sep) => line.includes(sep))) return false;

    const words = line.split(' ').filter(Boolean);
    if (words.length <= 1 || words.length > 5) return false;

    const lowered = new Set(words.map((w) => stripChars(w.toLowerCase(), '.')));
    for (const word of lowered) {
        if (TITLE_KEYWORDS.has(word) || COMPANY_SUFFIXES.has(word) || EDUCATION_KEYWORDS.has(word)) return false;
    }

    // Every word should be capitalised, all-caps, or a short particle (van, de).
    for (const word of words) {
        const stripped = stripChars(word, ".'-");
        if (!stripped) return false;
        if (isAllUpper(stripped) || startsUpper(stripped)) continue;
        if (NAME_PARTICLES.has(stripped.toLowerCase())) continue;
        return false;
    }

    return true;
}

/** Prefer an explicit label, then the first name-like line at the top. */
function extractName(lines, headerLines, email) {
    for (const line of lines.slice(0, 30)) {
        const match = RE_LABEL.name.exec(line);
        if (match) {
            const candidate = cleanLine(match[1]);
            if (candidate) return candidate;
        }
    }

    for (const line of (headerLines.length ? headerLines : lines).slice(0, 10)) {
        const cleaned = cleanLine(line);
        if (isNameLike(cleaned)) return cleaned;
    }

    // Last resort: derive from the email local-part ("jane.doe" -> "Jane Doe").
    if (email) {
        const local = email.split('@')[0];
        const parts = local.split(/[._\-]+/).filter((p) => /^[A-Za-z]+$/.test(p) && p.length > 1);
        if (parts.length >= 2) {
            return parts.slice(0, 3).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
        }
    }

    return '';
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/** First "City, Region" found among `candidateLines`, else empty. */
function findCityRegion(candidateLines) {
    for (const line of candidateLines) {
        // A contact or role line is often "Bengaluru, India | +91 ... | me@mail.com"
        // or "June 2024 - Present | Chennai, India".
        for (const rawFragment of line.split(RE_FRAGMENT_SPLIT)) {
            const fragment = stripGlyphNoise(cleanLine(rawFragment));
            if (!fragment || RE_EMAIL.test(fragment) || RE_URL.test(fragment)) continue;
            if (digitsOnly(fragment).length > 6) continue;
            if (RE_CITY_REGION.test(fragment)) return fragment;
        }
    }
    return '';
}

/**
 * A city with no region attached, sitting in a contact line.
 *
 * "Hyderabad | Ph: +91-... | Gmail: me@x.com" is extremely common and carries
 * no comma for `RE_CITY_REGION` to anchor on. Only lines that are demonstrably
 * contact lines are trusted, so a bare name or heading elsewhere in the document
 * can never be mistaken for a place.
 */
function bareCityInContactLine(line, name) {
    const fragments = line.split(RE_FRAGMENT_SPLIT).filter((f) => f.trim());

    // Trust this line only if it is demonstrably a contact line: several
    // separator-delimited parts, an email, or a decorative icon glyph — which
    // templates put in front of exactly these fields.
    const iconLabelled = RE_LEADING_NOISE.test(line.trim());
    if (fragments.length < 2 && !RE_EMAIL.test(line) && !iconLabelled) return '';

    const nameTokens = new Set(name.toLowerCase().split(' ').filter(Boolean));

    for (const rawFragment of fragments) {
        const fragment = stripGlyphNoise(cleanLine(rawFragment));
        if (fragment.length <= 2 || fragment.length > 40) continue;
        if (RE_EMAIL.test(fragment) || RE_URL.test(fragment) || RE_BARE_DOMAIN.test(fragment)) continue;
        // "Ph: +91-..." and "Gmail: ..." are labelled values, never places.
        if (fragment.includes(':') || /\d/.test(fragment)) continue;

        // A hyperlink's display text is usually the person's own name
        // ("(link) Varun Kumar"); never mistake that for a place.
        const fragmentTokens = fragment.toLowerCase().split(' ').filter(Boolean);
        if (nameTokens.size && fragmentTokens.every((token) => nameTokens.has(token))) continue;

        const words = fragment.split(' ').filter(Boolean);
        if (words.length < 1 || words.length > 3) continue;
        if (!words.every(startsUpper)) continue;
        if (tokensIntersect(fragment, TITLE_KEYWORDS, COMPANY_SUFFIXES, EDUCATION_KEYWORDS)) continue;

        return fragment;
    }

    return '';
}

/** Return `fragment` when it names a city we recognise, else empty. */
function isKnownCity(fragment) {
    const base = fragment.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return KNOWN_CITIES.has(base) ? fragment : '';
}

/** A recognised city standing alone on a header line, with no region. */
function knownCityInHeader(headerLines) {
    for (const line of headerLines) {
        for (const rawFragment of line.split(RE_FRAGMENT_SPLIT)) {
            const fragment = stripGlyphNoise(cleanLine(rawFragment));
            if (fragment.length > 2 && fragment.length <= 40) {
                const found = isKnownCity(fragment);
                if (found) return found;
            }
        }
    }
    return '';
}

/**
 * Last resort: a short, capitalised header line that is nothing else.
 *
 * Some résumés give the location a line of its own with no comma, separator or
 * icon — every structural signal absent — so this rules out everything it can
 * identify (the name, a job title, an employer, an institution, contact details)
 * and treats a lone survivor as the place. Deliberately last: it is a guess,
 * where every rule before it is evidence-based.
 */
function loneHeaderPlace(headerLines, name) {
    const nameTokens = new Set(name.toLowerCase().split(' ').filter(Boolean));

    for (const line of headerLines) {
        const fragment = stripGlyphNoise(cleanLine(line));
        if (fragment.length <= 2 || fragment.length > 40) continue;
        if (RE_EMAIL.test(fragment) || RE_URL.test(fragment) || RE_BARE_DOMAIN.test(fragment)) continue;
        if (/\d/.test(fragment) || fragment.includes(':')) continue;

        const words = fragment.split(' ').filter(Boolean);
        if (words.length < 1 || words.length > 3) continue;
        if (!words.every(startsUpper)) continue;

        const fragmentTokens = fragment.toLowerCase().split(' ').filter(Boolean);
        if (nameTokens.size && fragmentTokens.every((token) => nameTokens.has(token))) continue;
        // A multi-word capitalised fragment is far more likely a person's name
        // than an unlisted city; single words are the case worth guessing on.
        if (words.length > 1 && isNameLike(fragment)) continue;
        if (tokensIntersect(fragment, TITLE_KEYWORDS, TITLE_MODIFIERS, COMPANY_SUFFIXES, EDUCATION_KEYWORDS)) continue;

        return fragment;
    }

    return '';
}

function extractLocation(lines, headerLines, name = '') {
    for (const line of lines.slice(0, 30)) {
        const match = RE_LABEL.location.exec(line);
        if (match) {
            const candidate = cleanLine(match[1]);
            if (candidate) return candidate;
        }
    }

    // The header block is the most reliable place for a home location.
    const header = headerLines.slice(0, 15);
    if (header.length) {
        // "Bengaluru, India" — a region makes it unambiguous.
        const cityRegion = findCityRegion(header);
        if (cityRegion) return cityRegion;
        // "Hyderabad | Ph: ... | Gmail: ..." — bare city inside a contact line.
        for (const line of header) {
            const bare = bareCityInContactLine(line, name);
            if (bare) return bare;
        }
        // "Chennai" alone on its own line, recognised by name.
        const known = knownCityInHeader(header);
        if (known) return known;
    }

    // Some résumés state the location only beside the current role
    // ("June 2024 - Present | Chennai, India"). Restrict this to lines carrying
    // a date range: without that guard, any "Word, Word" pair elsewhere in the
    // document — "Python, SQL" in a skills list — would be read as a place.
    const roleMetaLines = lines.slice(0, 60).filter((line) => RE_DATE_RANGE.test(line));
    const fromRole = findCityRegion(roleMetaLines);
    if (fromRole) return fromRole;

    // Nothing matched a known shape or a known city: fall back to a structural
    // guess over the header block.
    return loneHeaderPlace(header, name);
}

// ---------------------------------------------------------------------------
// Titles / designations
// ---------------------------------------------------------------------------

/** True when a line reads as a job title. */
function isTitleLike(line) {
    if (line.length < 2 || line.length > 80 || looksLikeSentence(line)) return false;
    if (RE_EMAIL.test(line) || RE_URL.test(line)) return false;

    const words = tokens(line);
    if (!words.length || words.length > 8) return false;
    if (!words.some((word) => TITLE_KEYWORDS.has(stripChars(word, '.')))) return false;

    // Guard against prose that merely mentions a role.
    const unknown = words.filter((w) => {
        const base = stripChars(w, '.');
        return !TITLE_KEYWORDS.has(base) && !TITLE_MODIFIERS.has(base);
    });
    return unknown.length <= 2;
}

/** Split "Senior Engineer at Acme Inc." / "Engineer | Acme" into its parts. */
function splitRoleAndCompany(line) {
    for (const pattern of [/\s+(?:at|@|,|with)\s+/, /\s*[|•·–—]\s*/]) {
        const parts = splitOnce(line, pattern);
        if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
            return [parts[0].trim(), parts[1].trim()];
        }
    }
    return [line.trim(), ''];
}

function extractDesignations(experienceLines, lines) {
    const found = [];
    for (const raw of (experienceLines.length ? experienceLines : lines)) {
        const cleaned = cleanLine(raw);
        let [role] = splitRoleAndCompany(cleaned);
        // Drop trailing date ranges before testing.
        role = stripChars(role.replace(RE_DATE_RANGE_G, ''), ' -–—|,');
        if (isTitleLike(role)) found.push(role);
    }
    return dedupe(found, 15);
}

function extractJobTitle(lines, headerLines, designations) {
    for (const line of lines.slice(0, 30)) {
        const match = RE_LABEL.title.exec(line);
        if (match) {
            const candidate = cleanLine(match[1]);
            if (candidate) return candidate;
        }
    }

    // A title directly under the name is the most reliable signal.
    for (const line of (headerLines.length ? headerLines : lines).slice(0, 8)) {
        const cleaned = cleanLine(line);
        if (isTitleLike(cleaned)) return cleaned;
    }

    // Otherwise assume the résumé lists the most recent role first.
    return designations.length ? designations[0] : '';
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

function isCompanyLike(rawFragment) {
    const fragment = stripChars(rawFragment, ' ,.-|');
    if (fragment.length < 2 || fragment.length > 70 || looksLikeSentence(fragment)) return false;
    if (RE_EMAIL.test(fragment) || RE_URL.test(fragment)) return false;

    const words = fragment.split(' ').filter(Boolean);
    if (!words.length || words.length > 7) return false;

    const lowered = words.map((w) => stripChars(w.toLowerCase(), '.,'));
    if (lowered.some((w) => EDUCATION_KEYWORDS.has(w))) return false;

    const hasSuffix = lowered.some((w) => COMPANY_SUFFIXES.has(w));
    const capitalised = words.filter((w) => startsUpper(w) || isAllUpper(w)).length;
    return hasSuffix && capitalised >= 1;
}

/**
 * True when a line looks like a bare employer name on its own line.
 *
 * Many résumés lay a role out as three lines — title, employer, dates — and the
 * employer often carries no legal suffix ("NielsenIQ", "Infosys"), so
 * `isCompanyLike` cannot see it. This is deliberately strict, and is only
 * consulted when suffix matching found nothing at all.
 */
function isStandaloneOrg(rawLine) {
    const stripped = String(rawLine).trim();
    if (stripped && BULLET_CHARS.includes(stripped[0])) return false; // bullets are achievements

    const line = cleanLine(stripped);
    if (line.length < 2 || line.length > 60 || looksLikeSentence(line)) return false;
    if (RE_EMAIL.test(line) || RE_URL.test(line) || RE_BARE_DOMAIN.test(line)) return false;
    // Meta lines pair dates with a location; neither part is an employer.
    if (line.includes('|') || RE_DATE_RANGE.test(line)) return false;

    const words = line.split(' ').filter(Boolean);
    if (words.length < 1 || words.length > 5) return false;
    if (!words.some(startsUpper)) return false;
    if (isTitleLike(line)) return false;
    if (tokensIntersect(line, EDUCATION_KEYWORDS)) return false; // institutions belong to education
    // Reject anything that is mostly punctuation or digits.
    return /[A-Za-z]{2}/.test(line) && digitsOnly(line).length <= 4;
}

function extractCompanies(experienceLines, lines) {
    const found = [];

    for (const raw of (experienceLines.length ? experienceLines : lines)) {
        const cleaned = stripChars(cleanLine(raw).replace(RE_DATE_RANGE_G, ''), ' -–—|,');
        if (!cleaned) continue;

        // "Role at Company" — the right-hand side is the strongest candidate.
        const atMatch = /\b(?:at|@)\s+(.+)$/i.exec(cleaned);
        if (atMatch) {
            const candidate = stripChars(atMatch[1], ' ,.-|');
            if (isCompanyLike(candidate)) {
                found.push(candidate);
                continue;
            }
        }

        for (const fragment of cleaned.split(/\s*[|•·,–—]\s*|\s+-\s+/)) {
            if (isCompanyLike(fragment)) found.push(stripChars(fragment, ' ,.-|'));
        }
    }

    if (found.length) return dedupe(found, 15);

    // Fallback: no employer carried a recognisable legal suffix, so fall back to
    // the structural "employer on its own line" pattern.
    return dedupe(experienceLines.filter(isStandaloneOrg).map(cleanLine), 15);
}

// ---------------------------------------------------------------------------
// Total experience
// ---------------------------------------------------------------------------

function monthIndex(year, month) {
    return year * 12 + (month - 1);
}

/**
 * Total months covered by the date ranges in the experience section.
 * Overlapping ranges (concurrent roles, promotions listed separately) are merged
 * so they are not double-counted.
 */
function collectEmploymentMonths(experienceLines) {
    const now = new Date();
    const intervals = [];

    for (const line of experienceLines) {
        for (const match of allMatches(RE_DATE_RANGE_G, line)) {
            const groups = match.groups || {};
            const startYear = parseInt(groups.y1, 10);
            const startMonth = MONTHS[stripChars(String(groups.m1 || '').toLowerCase(), '. ')] || 1;

            let endYear;
            let endMonth;
            if (groups.now) {
                endYear = now.getFullYear();
                endMonth = now.getMonth() + 1;
            } else {
                endYear = parseInt(groups.y2, 10);
                endMonth = MONTHS[stripChars(String(groups.m2 || '').toLowerCase(), '. ')] || 12;
            }

            const start = monthIndex(startYear, startMonth);
            const end = monthIndex(endYear, endMonth);
            if (end < start || startYear < 1950 || endYear > now.getFullYear() + 1) continue;
            intervals.push([start, end + 1]);
        }
    }

    if (!intervals.length) return 0;

    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let total = 0;
    let [currentStart, currentEnd] = intervals[0];
    for (const [start, end] of intervals.slice(1)) {
        if (start <= currentEnd) {
            currentEnd = Math.max(currentEnd, end);
        } else {
            total += currentEnd - currentStart;
            [currentStart, currentEnd] = [start, end];
        }
    }
    total += currentEnd - currentStart;

    return total;
}

function formatDuration(months) {
    const years = Math.floor(months / 12);
    const remainder = months % 12;
    if (years && remainder) {
        return `~${years} year${years !== 1 ? 's' : ''} ${remainder} month${remainder !== 1 ? 's' : ''}`;
    }
    if (years) return `~${years} year${years !== 1 ? 's' : ''}`;
    return `~${remainder} month${remainder !== 1 ? 's' : ''}`;
}

function extractTotalExperience(text, lines, experienceLines) {
    for (const line of lines.slice(0, 40)) {
        const match = RE_LABEL.experience.exec(line);
        if (match) {
            const candidate = cleanLine(match[1]);
            if (candidate && candidate.length < 40) return candidate;
        }
    }

    // An explicit claim in the summary beats anything derived.
    const stated = [];
    for (const pattern of [RE_YEARS_BEFORE, RE_YEARS_AFTER, RE_YEARS_PLUS]) {
        for (const match of allMatches(pattern, text)) stated.push(parseFloat(match[1]));
    }
    if (stated.length) {
        const best = Math.max(...stated);
        // Match Python's "%g": drop a trailing ".0" but keep "4.5".
        return `${Number(best.toFixed(2))}+ years`;
    }

    const months = collectEmploymentMonths(experienceLines);
    if (months >= 3) return `${formatDuration(months)} (derived from employment dates)`;

    return '';
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** Split one skills line into individual skills. */
function splitSkillLine(line) {
    let cleaned = cleanLine(line);
    if (!cleaned) return [];

    // "Languages: Python, Go" — keep only the values, drop the sub-label.
    if (cleaned.includes(':')) {
        const index = cleaned.indexOf(':');
        const head = cleaned.slice(0, index);
        const tail = cleaned.slice(index + 1);
        if (head.split(' ').filter(Boolean).length <= 4 && tail.trim()) cleaned = tail.trim();
    }

    const skills = [];
    for (const part of cleaned.split(/\s*[,;|/•·]\s*|\s{3,}|\s+[-–—]\s+/)) {
        const skill = stripChars(part, ' .;:-–—()[]');
        if (skill.length <= 1 || skill.length > 45) continue;
        if (/^\d+$/.test(skill) || skill.split(' ').filter(Boolean).length > 5) continue;
        if (!/[A-Za-z]/.test(skill)) continue;
        // Drop proficiency ratings such as "Python (Advanced)" leftovers.
        if (LANGUAGE_PROFICIENCY.has(skill.toLowerCase())) continue;
        skills.push(skill);
    }

    return skills;
}

/** "soft" when the skill matches the soft-skill vocabulary, else "technical". */
function classifySkill(skill) {
    const normalised = skill.toLowerCase().replace(/[^a-z\s\-]/g, '').trim();
    if (SOFT_SKILLS.has(normalised)) return 'soft';
    // Catch phrases like "Excellent Communication Skills".
    for (const soft of SOFT_SKILLS) {
        if (soft.length > 6 && normalised.includes(soft)) return 'soft';
    }
    return 'technical';
}

/** Returns `{ all, technical, soft }`. */
function extractSkills(sections) {
    const generic = sectionText(sections, 'skills');
    const technicalSection = sectionText(sections, 'technical_skills');
    const softSection = sectionText(sections, 'soft_skills');

    const technical = [];
    const soft = [];
    const everything = [];

    for (const line of technicalSection) {
        for (const skill of splitSkillLine(line)) {
            technical.push(skill);
            everything.push(skill);
        }
    }

    for (const line of softSection) {
        for (const skill of splitSkillLine(line)) {
            soft.push(skill);
            everything.push(skill);
        }
    }

    for (const line of generic) {
        // A long prose line inside a skills section is a description, not a list.
        if (looksLikeSentence(line) && !line.includes(',')) continue;
        for (const skill of splitSkillLine(line)) {
            everything.push(skill);
            (classifySkill(skill) === 'soft' ? soft : technical).push(skill);
        }
    }

    return {
        all: dedupe(everything, 120),
        technical: dedupe(technical, 120),
        soft: dedupe(soft, 60),
    };
}

// ---------------------------------------------------------------------------
// Education / certifications / projects / languages
// ---------------------------------------------------------------------------

function extractEducation(sections, lines) {
    const educationLines = sectionText(sections, 'education');
    const entries = [];

    for (const raw of educationLines) {
        const cleaned = cleanLine(raw);
        if (!cleaned || cleaned.length < 3) continue;
        if (looksLikeSentence(cleaned) && !tokensIntersect(cleaned, EDUCATION_KEYWORDS)) continue;
        entries.push(cleaned);
    }

    if (entries.length) return dedupe(entries, 15);

    // No education section: scan the whole document for degree/institution lines.
    const fallback = [];
    for (const raw of lines) {
        const cleaned = cleanLine(raw);
        if (cleaned && !looksLikeSentence(cleaned) && tokensIntersect(cleaned, EDUCATION_KEYWORDS)) {
            fallback.push(cleaned);
        }
    }
    return dedupe(fallback, 10);
}

function extractCertifications(sections, lines) {
    const certLines = sectionText(sections, 'certifications');
    const entries = [];

    for (const raw of certLines) {
        const cleaned = cleanLine(raw);
        if (cleaned && cleaned.length >= 3 && cleaned.length <= 140) entries.push(cleaned);
    }
    if (entries.length) return dedupe(entries, 20);

    const fallback = [];
    for (const raw of lines) {
        const cleaned = cleanLine(raw);
        if (!cleaned || cleaned.length > 120 || looksLikeSentence(cleaned)) continue;
        const lowered = cleaned.toLowerCase();
        if (lowered.includes('certified') || lowered.includes('certification')) {
            fallback.push(cleaned);
        } else if (CERTIFICATION_HINTS.some((hint) => lowered.includes(hint)) && lowered.includes('certificat')) {
            fallback.push(cleaned);
        }
    }

    return dedupe(fallback, 15);
}

/**
 * Project *titles*, not their bullet-point descriptions.
 * A title is a short line; bullets and prose beneath it are treated as detail.
 */
function extractProjects(sections) {
    const projectLines = sections.projects || [];
    const titles = [];

    for (const raw of projectLines) {
        const stripped = String(raw).trim();
        const isBullet = Boolean(stripped) && BULLET_CHARS.includes(stripped[0]);
        const cleaned = cleanLine(stripped);

        if (!cleaned || cleaned.length < 3) continue;
        if (isBullet || looksLikeSentence(cleaned)) continue;

        // "Inventory Tracker - React, Node, Postgres" -> keep the whole line, it
        // is informative, but cap the length for display.
        titles.push(cleaned.slice(0, 140));
    }

    return dedupe(titles, 20);
}

/** Spoken languages, with proficiency preserved when it is stated. */
function extractLanguages(sections, text) {
    const candidates = [];
    const languageLines = [...sectionText(sections, 'languages')];

    if (!languageLines.length) {
        for (const line of String(text).split(/\r\n|\r|\n/)) {
            if (/^\s*languages?(?:\s+known)?\s*[:\-]/i.test(line)) {
                languageLines.push(splitOnce(line, /[:\-]/).pop());
            }
        }
    }

    for (const line of languageLines) {
        for (const part of cleanLine(line).split(/\s*[,;|/•·]\s*|\s{3,}/)) {
            const fragment = stripChars(part, ' .;:-–—');
            if (!fragment || fragment.length > 40) continue;
            // "English (Native)" / "Hindi - Fluent"
            const base = fragment.split(/\s*[\(\[\-–—:]\s*/)[0].trim().toLowerCase();
            if (KNOWN_LANGUAGES.has(base)) candidates.push(fragment);
        }
    }

    if (candidates.length) return dedupe(candidates, 15);

    // Nothing structured: look for language names near the word "languages".
    // Results are ordered by where each name appears in the document (the
    // reference implementation iterated an unordered set, so its order varied
    // between runs); the set of languages found is identical either way.
    const match = /languages?[^\n]{0,200}/i.exec(text);
    const window = match ? match[0].toLowerCase() : '';

    const found = [];
    for (const name of KNOWN_LANGUAGES) {
        const position = window.search(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
        if (position >= 0) found.push({ name, position });
    }
    found.sort((a, b) => a.position - b.position);

    return dedupe(found.map((item) => item.name.replace(/\b\w/g, (c) => c.toUpperCase())), 10);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Field order used by the UI and by the "fields detected" statistic.
export const RESUME_FIELDS = [
    'name', 'email', 'phone', 'location', 'linkedin', 'github', 'portfolio',
    'jobTitle', 'experience', 'skills', 'technicalSkills', 'softSkills',
    'education', 'certifications', 'projects', 'companies', 'designations',
    'languages',
];

const LIST_FIELDS = new Set([
    'skills', 'technicalSkills', 'softSkills', 'education',
    'certifications', 'projects', 'companies', 'designations', 'languages',
]);

/** A fully-populated, all-empty résumé payload (used on the error path). */
export function emptyResumeInfo() {
    const info = {};
    for (const field of RESUME_FIELDS) info[field] = LIST_FIELDS.has(field) ? [] : '';
    return info;
}

/**
 * Mine `text` for the résumé fields shown on the Generate Score page.
 * Never throws: a document that is not a résumé simply yields empty values.
 *
 * @param {string} text Plain text, ideally produced by Document Intelligence.
 * @returns {object} Field map — see RESUME_FIELDS.
 */
export function extractResumeFields(text) {
    if (!text || !String(text).trim()) return emptyResumeInfo();

    try {
        const lines = splitLines(text);
        const sections = segmentSections(lines);
        const headerLines = sections.header || [];
        const experienceLines = sectionText(sections, 'experience');

        const email = extractEmail(text);
        const name = extractName(lines, headerLines, email);
        const designations = extractDesignations(experienceLines, lines);
        const skills = extractSkills(sections);

        return {
            name,
            email,
            phone: extractPhone(text, lines),
            // `name` is passed so a name line can never be mistaken for a place.
            location: extractLocation(lines, headerLines, name),
            linkedin: extractLinkedin(text),
            github: extractGithub(text),
            portfolio: extractPortfolio(text, email),
            jobTitle: extractJobTitle(lines, headerLines, designations),
            experience: extractTotalExperience(text, lines, experienceLines),
            skills: skills.all,
            technicalSkills: skills.technical,
            softSkills: skills.soft,
            education: extractEducation(sections, lines),
            certifications: extractCertifications(sections, lines),
            projects: extractProjects(sections),
            companies: extractCompanies(experienceLines, lines),
            designations,
            languages: extractLanguages(sections, text),
        };
    } catch (error) {
        // Field mining is a display nicety layered on top of extraction — it must
        // never be able to fail a résumé upload that otherwise succeeded.
        console.error('⚠️ [ResumeFields] Extraction failed, returning empty fields:', error.message);
        return emptyResumeInfo();
    }
}

/** Small summary the UI shows as a completeness badge. */
export function resumeStats(info) {
    const detected = RESUME_FIELDS.filter((field) => {
        const value = info?.[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });

    return {
        fieldsDetected: detected.length,
        totalFields: RESUME_FIELDS.length,
        missingFields: RESUME_FIELDS.filter((field) => !detected.includes(field)),
    };
}
