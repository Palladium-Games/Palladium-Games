// About:Blank Cloaking System
// This script creates an about:blank tab and loads the site content into it, then closes the original tab

(function() {
    'use strict';
    
    // Check if we're already in a cloaked window
    if (window.location.href === 'about:blank' || window.location.protocol === 'about:') {
        return; // Don't cloak if already cloaked
    }
    
    // Function to create cloaked window
    function createCloakedWindow() {
        try {
            // Get the current page's URL
            const currentUrl = window.location.href;
            
            // Create a new window with about:blank
            const newWindow = window.open('about:blank', '_blank', 'width=' + window.innerWidth + ',height=' + window.innerHeight);
            
            if (!newWindow) {
                console.warn('Popup blocked. Please allow popups for this site.');
                // Fallback: try redirecting current window
                window.location.replace('about:blank');
                setTimeout(() => {
                    document.open();
                    document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>${document.title}</title>
                            <style>
                                * { margin: 0; padding: 0; box-sizing: border-box; }
                                html, body { width: 100%; height: 100%; overflow: hidden; }
                                iframe { width: 100%; height: 100%; border: none; }
                            </style>
                        </head>
                        <body>
                            <iframe src="${currentUrl}" style="width: 100%; height: 100%; border: none;"></iframe>
                        </body>
                        </html>
                    `);
                    document.close();
                }, 100);
                return;
            }
            
            // Write the HTML structure to the new window
            newWindow.document.open();
            newWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${document.title}</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        html, body { width: 100%; height: 100%; overflow: hidden; }
                        iframe { width: 100%; height: 100%; border: none; }
                    </style>
                </head>
                <body>
                    <iframe src="${currentUrl}" style="width: 100%; height: 100%; border: none;"></iframe>
                </body>
                </html>
            `);
            newWindow.document.close();
            
            // Focus the new window
            newWindow.focus();
            
            // Try to close the original window
            // Note: This only works if the window was opened by JavaScript
            setTimeout(() => {
                try {
                    if (window.opener === null && window.history.length <= 1) {
                        window.close();
                    } else {
                        // If we can't close, redirect to about:blank
                        window.location.replace('about:blank');
                    }
                } catch (e) {
                    // If window.close() fails, redirect to about:blank
                    window.location.replace('about:blank');
                }
            }, 300);
            
        } catch (e) {
            console.error('Cloaking failed:', e);
        }
    }
    
    // Alternative method using iframe injection
    function injectCloaking() {
        // Check if we should cloak
        const urlParams = new URLSearchParams(window.location.search);
        const shouldCloak = urlParams.get('cloak') === 'true' || 
                          localStorage.getItem('enableCloaking') === 'true';
        
        if (!shouldCloak) {
            return;
        }
        
        // Replace the entire page with an iframe
        document.open();
        document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${document.title}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    html, body { width: 100%; height: 100%; overflow: hidden; }
                    iframe { width: 100%; height: 100%; border: none; }
                </style>
            </head>
            <body>
                <iframe src="${window.location.href.split('?')[0]}" style="width: 100%; height: 100%; border: none;"></iframe>
            </body>
            </html>
        `);
        document.close();
    }
    
    // Function to enable cloaking for links
    function enableLinkCloaking() {
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a[data-cloak]');
            if (link) {
                e.preventDefault();
                const url = link.href || link.getAttribute('href');
                
                // Create cloaked window
                const newWindow = window.open('about:blank', '_blank');
                if (newWindow) {
                    newWindow.document.open();
                    newWindow.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Loading...</title>
                            <style>
                                * { margin: 0; padding: 0; box-sizing: border-box; }
                                html, body { width: 100%; height: 100%; overflow: hidden; }
                                iframe { width: 100%; height: 100%; border: none; }
                            </style>
                        </head>
                        <body>
                            <iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>
                        </body>
                        </html>
                    `);
                    newWindow.document.close();
                }
            }
        });
    }
    
    // Auto-cloak on page load if enabled
    if (localStorage.getItem('autoCloak') === 'true') {
        // Only auto-cloak if not already in an iframe
        if (window.self === window.top) {
            setTimeout(() => {
                createCloakedWindow();
            }, 1000);
        }
    }
    
    // Enable link cloaking
    enableLinkCloaking();
    
    // Expose functions globally for manual control
    window.titaniumCloak = {
        enable: function() {
            localStorage.setItem('enableCloaking', 'true');
            localStorage.setItem('autoCloak', 'true');
            createCloakedWindow();
        },
        disable: function() {
            localStorage.setItem('enableCloaking', 'false');
            localStorage.setItem('autoCloak', 'false');
        },
        cloakLink: function(url) {
            const newWindow = window.open('about:blank', '_blank');
            if (newWindow) {
                newWindow.document.open();
                newWindow.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Loading...</title>
                        <style>
                            * { margin: 0; padding: 0; box-sizing: border-box; }
                            html, body { width: 100%; height: 100%; overflow: hidden; }
                            iframe { width: 100%; height: 100%; border: none; }
                        </style>
                    </head>
                    <body>
                        <iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>
                    </body>
                    </html>
                `);
                newWindow.document.close();
            }
        }
    };
    
})();
