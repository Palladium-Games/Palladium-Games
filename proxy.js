// Proxy / "Run your own instance of Chrome"
// Set this to your proxy service base URL to load all sites through it (e.g. Ultraviolet, Holy Unblocker).
// Format: base URL that accepts the target as a query param, e.g. "https://your-proxy.com/uv/service/?url="
// Leave empty to load sites directly in the iframe (many sites will block embedding).
const PROXY_SERVICE_BASE = '';

// Browser functionality
document.addEventListener('DOMContentLoaded', function() {
    const browserFrame = document.getElementById('browserFrame');
    const browserAddressInput = document.getElementById('browserAddressInput');
    const browserAddressForm = document.getElementById('browserAddressForm');
    const browserBack = document.getElementById('browserBack');
    const browserForward = document.getElementById('browserForward');
    const browserRefresh = document.getElementById('browserRefresh');
    const browserHome = document.getElementById('browserHome');
    const browserLoading = document.getElementById('browserLoading');
    
    let history = [];
    let displayHistory = []; // URL to show in address bar (same as history when not using proxy)
    let historyIndex = -1;
    
    // Function to detect if input is a URL
    function isUrl(input) {
        // Check if it starts with http:// or https://
        if (input.startsWith('http://') || input.startsWith('https://')) {
            return true;
        }
        
        // Check if it looks like a domain (contains TLD)
        const tldPattern = /\.(com|org|net|edu|gov|io|co|uk|de|fr|jp|cn|au|ca|us|tv|me|info|xyz|site|online|tech|dev|app|blog|store|shop|club|space|website|news|email|cloud|design|art|music|video|game|games|fun|play|live|world|global|international|biz|name|pro|mobi|asia|jobs|travel|xxx|academy|agency|center|company|digital|group|international|media|network|online|solutions|systems|technology|today|website|works|zone|click|download|faith|loan|men|party|review|science|software|stream|study|trade|win|work|accountant|architect|associates|consulting|contractors|directory|engineering|enterprises|equipment|estate|events|exchange|financial|foundation|gallery|graphics|holdings|industries|institute|international|investments|limited|management|marketing|partners|productions|properties|pub|recruitment|rentals|repair|report|reviews|services|shopping|show|social|software|solar|solutions|supplies|support|systems|tax|technology|tips|today|tools|top|tours|town|toys|training|travel|university|vacations|ventures|video|villas|vision|watch|weather|website|wedding|wiki|win|work|works|world|wtf|zone)$/i;
        
        // Remove common prefixes
        const cleaned = input.replace(/^(www\.|http:\/\/|https:\/\/)/i, '');
        
        // Check if it contains a TLD and doesn't have spaces
        if (tldPattern.test(cleaned) && !cleaned.includes(' ')) {
            return true;
        }
        
        // Check for IP address pattern
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipPattern.test(cleaned)) {
            return true;
        }
        
        return false;
    }
    
    // Function to get search URL - use multiple search engines as fallback
    function getSearchUrl(query) {
        // Try multiple search engines
        const searchEngines = [
            `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
            `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
            `https://yandex.com/search/?text=${encodeURIComponent(query)}`,
            `https://www.ecosia.org/search?q=${encodeURIComponent(query)}`
        ];
        return searchEngines[0]; // Use Bing as primary
    }
    
    // Proxy service: when set, load all URLs through it (run your own Chrome instance).
    function buildProxyLoadUrl(targetUrl) {
        const base = (PROXY_SERVICE_BASE || '').trim();
        if (!base) return null;
        if (base.includes('url=')) return base + encodeURIComponent(targetUrl);
        return base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(targetUrl);
    }
    
    // Redirect page for blocked domains (no script tag to avoid parsing issues in data URL HTML)
    function loadBlockedUrl(url) {
        const esc = (s) => String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const safeUrl = esc(url);
        const redirectHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Redirecting</title>' +
            '<meta http-equiv="refresh" content="0;url=' + safeUrl + '"></head>' +
            '<body><p>Redirecting...</p><a href="' + safeUrl + '">Click here if not redirected</a></body></html>';
        return 'data:text/html;charset=utf-8,' + encodeURIComponent(redirectHtml);
    }
    
    function loadUrl(input) {
        if (!input) return;
        
        const trimmedInput = input.trim();
        let url = trimmedInput;
        
        // Check if it's already a full URL
        if (trimmedInput.startsWith('http://') || trimmedInput.startsWith('https://')) {
            url = trimmedInput;
        } 
        // Check if it's a URL (domain)
        else if (isUrl(trimmedInput)) {
            // Add https:// if missing
            url = trimmedInput.startsWith('http://') ? trimmedInput : 'https://' + trimmedInput;
        }
        // Otherwise treat as search query
        else {
            url = getSearchUrl(trimmedInput);
        }
        
        const canonicalUrl = url; // The real URL we're visiting (for display and proxy input)
        let finalLoadUrl = url;
        
        // Use proxy service when configured (run your own instance of Chrome)
        const proxyUrl = buildProxyLoadUrl(canonicalUrl);
        if (proxyUrl) {
            finalLoadUrl = proxyUrl;
        } else {
            // No proxy: check if URL is blocked and use redirect page
            try {
                const urlObj = new URL(canonicalUrl);
                const hostname = urlObj.hostname.toLowerCase();
                const blockedDomains = [
                    'poki.com', 'www.poki.com', 
                    'google.com', 'www.google.com',
                    'duckduckgo.com', 'www.duckduckgo.com',
                    'bing.com', 'www.bing.com'
                ];
                for (let domain of blockedDomains) {
                    if (hostname.includes(domain)) {
                        finalLoadUrl = loadBlockedUrl(canonicalUrl);
                        break;
                    }
                }
            } catch (e) {
                // URL parsing failed, keep finalLoadUrl as canonicalUrl
            }
        }
        
        browserLoading.style.display = 'flex';
        
        browserFrame.removeAttribute('sandbox');
        browserFrame.src = finalLoadUrl;
        
        history = history.slice(0, historyIndex + 1);
        history.push(finalLoadUrl);
        displayHistory = displayHistory.slice(0, historyIndex + 1);
        displayHistory.push(canonicalUrl);
        historyIndex = history.length - 1;
        updateNavButtons();
        
        browserAddressInput.value = canonicalUrl;
    }
    
    // Check for search query from homepage
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('q');
    if (searchQuery) {
        loadUrl(searchQuery);
    } else {
        browserFrame.src = 'about:blank';
    }
    
    function updateNavButtons() {
        browserBack.disabled = historyIndex <= 0;
        browserForward.disabled = historyIndex >= history.length - 1;
    }
    
    browserAddressForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const url = browserAddressInput.value.trim();
        if (url) {
            loadUrl(url);
        }
    });
    
    browserBack.addEventListener('click', function() {
        if (historyIndex > 0) {
            historyIndex--;
            browserLoading.style.display = 'flex';
            browserFrame.src = history[historyIndex];
            browserAddressInput.value = displayHistory[historyIndex] != null ? displayHistory[historyIndex] : history[historyIndex];
            updateNavButtons();
        }
    });
    
    browserForward.addEventListener('click', function() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            browserLoading.style.display = 'flex';
            browserFrame.src = history[historyIndex];
            browserAddressInput.value = displayHistory[historyIndex] != null ? displayHistory[historyIndex] : history[historyIndex];
            updateNavButtons();
        }
    });
    
    browserRefresh.addEventListener('click', function() {
        if (browserFrame.src && browserFrame.src !== 'about:blank') {
            browserLoading.style.display = 'flex';
            browserFrame.src = browserFrame.src;
        }
    });
    
    browserHome.addEventListener('click', function() {
        window.location.href = 'index.html';
    });
    
    browserFrame.addEventListener('load', function() {
        browserLoading.style.display = 'none';
        if (!PROXY_SERVICE_BASE || !PROXY_SERVICE_BASE.trim()) {
            try {
                const currentUrl = browserFrame.contentWindow.location.href;
                browserAddressInput.value = currentUrl;
            } catch (e) {
                // Cross-origin: keep current address bar (displayHistory)
            }
        }
    });
    
    browserFrame.addEventListener('error', function() {
        browserLoading.style.display = 'none';
    });
});
