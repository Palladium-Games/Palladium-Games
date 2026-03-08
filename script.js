// Sidebar Menu Toggle
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarMenu = document.querySelector('.sidebar-menu');

if (sidebarToggle && sidebarMenu) {
    sidebarToggle.addEventListener('click', () => {
        sidebarMenu.classList.toggle('open');
        sidebarToggle.classList.toggle('active');
    });
}

// Mobile Navigation Toggle
const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('.nav-menu');

if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        navToggle.classList.toggle('active');
    });
}

// Close mobile menu when clicking on a link
document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        navToggle.classList.remove('active');
    });
});

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offsetTop = target.offsetTop - 70; // Account for fixed navbar
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    });
});

// Navbar background on scroll
let lastScroll = 0;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 100) {
        navbar.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    } else {
        navbar.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
    }
    
    lastScroll = currentScroll;
});

// Form submission
const contactForm = document.querySelector('.contact-form');
if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Get form values
        const formData = new FormData(contactForm);
        const name = formData.get('name');
        const email = formData.get('email');
        const message = formData.get('message');
        
        // Simple validation
        if (name && email && message) {
            // In a real application, you would send this data to a server
            alert('Thank you for your message! We\'ll get back to you soon.');
            contactForm.reset();
        }
    });
}

// Intersection Observer for fade-in animations with stagger
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
        if (entry.isIntersecting && !entry.target.classList.contains('animate')) {
            setTimeout(() => {
                entry.target.classList.add('animate');
            }, index * 50); // Stagger animation
        }
    });
}, observerOptions);

// Observe cards for animation
document.querySelectorAll('.game-card, .category-card').forEach(card => {
    observer.observe(card);
});

// Parallax effect for hero background
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroBackground = document.querySelector('.hero-background');
    if (heroBackground) {
        heroBackground.style.transform = `translateY(${scrolled * 0.5}px)`;
    }
});

// Homepage search functionality
document.addEventListener('DOMContentLoaded', function() {
    const homepageSearchForm = document.getElementById('homepageSearchForm');
    if (homepageSearchForm) {
        homepageSearchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const searchInput = document.getElementById('homepageSearchInput');
            const query = searchInput.value.trim();
            if (query) {
                window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            }
        });
    }
});

// Fade in animation for elements on scroll
const fadeElements = document.querySelectorAll('.hero-title, .hero-subtitle, .hero-search');
fadeElements.forEach((el, index) => {
    el.style.animationDelay = `${0.3 + index * 0.2}s`;
});

// Smooth scroll reveal for sections
const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
});

document.querySelectorAll('.section').forEach(section => {
    section.style.opacity = '0';
    section.style.transform = 'translateY(30px)';
    section.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
    sectionObserver.observe(section);
});

// Filter tabs functionality
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
    });
});

// Snake Game
const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const scoreElement = document.getElementById('score');
const highScoreElement = document.getElementById('highScore');

if (canvas && ctx && startBtn && resetBtn && scoreElement && highScoreElement) {
const gridSize = 20;
const tileCount = canvas.width / gridSize;

let snake = [{ x: 10, y: 10 }];
let food = {};
let dx = 0;
let dy = 0;
let score = 0;
let highScore = localStorage.getItem('snakeHighScore') || 0;
let gameRunning = false;
let gameLoop;

highScoreElement.textContent = highScore;

function randomFood() {
    food = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount)
    };
}

function drawGame() {
    clearCanvas();
    drawSnake();
    drawFood();
    drawScore();
}

function clearCanvas() {
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawSnake() {
    ctx.fillStyle = '#00ff88';
    snake.forEach((segment, index) => {
        if (index === 0) {
            ctx.fillStyle = '#00ff88';
        } else {
            ctx.fillStyle = '#00cc6a';
        }
        ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);
    });
}

function drawFood() {
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);
}

function drawScore() {
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Poppins';
    ctx.fillText(`Score: ${score}`, 10, 25);
}

function moveSnake() {
    const head = { x: snake[0].x + dx, y: snake[0].y + dy };
    
    if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
        gameOver();
        return;
    }
    
    if (head.x === food.x && head.y === food.y) {
        score++;
        scoreElement.textContent = score;
        randomFood();
    } else {
        snake.pop();
    }
    
    snake.unshift(head);
    
    for (let i = 1; i < snake.length; i++) {
        if (head.x === snake[i].x && head.y === snake[i].y) {
            gameOver();
            return;
        }
    }
}

function gameOver() {
    gameRunning = false;
    clearInterval(gameLoop);
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('snakeHighScore', highScore);
        highScoreElement.textContent = highScore;
    }
    alert(`Game Over! Score: ${score}`);
}

function changeDirection(e) {
    if (!gameRunning) return;
    
    const LEFT_KEY = 37;
    const RIGHT_KEY = 39;
    const UP_KEY = 38;
    const DOWN_KEY = 40;
    
    const keyPressed = e.keyCode;
    const goingUp = dy === -1;
    const goingDown = dy === 1;
    const goingRight = dx === 1;
    const goingLeft = dx === -1;
    
    if (keyPressed === LEFT_KEY && !goingRight) {
        dx = -1;
        dy = 0;
    }
    if (keyPressed === UP_KEY && !goingDown) {
        dx = 0;
        dy = -1;
    }
    if (keyPressed === RIGHT_KEY && !goingLeft) {
        dx = 1;
        dy = 0;
    }
    if (keyPressed === DOWN_KEY && !goingUp) {
        dx = 0;
        dy = 1;
    }
    
    // WASD support
    if (e.key === 'a' && !goingRight) {
        dx = -1;
        dy = 0;
    }
    if (e.key === 'w' && !goingDown) {
        dx = 0;
        dy = -1;
    }
    if (e.key === 'd' && !goingLeft) {
        dx = 1;
        dy = 0;
    }
    if (e.key === 's' && !goingUp) {
        dx = 0;
        dy = 1;
    }
}

startBtn.addEventListener('click', () => {
    if (!gameRunning) {
        snake = [{ x: 10, y: 10 }];
        dx = 0;
        dy = 0;
        score = 0;
        scoreElement.textContent = score;
        randomFood();
        gameRunning = true;
        gameLoop = setInterval(() => {
            moveSnake();
            drawGame();
        }, 100);
    }
});

resetBtn.addEventListener('click', () => {
    gameRunning = false;
    clearInterval(gameLoop);
    snake = [{ x: 10, y: 10 }];
    dx = 0;
    dy = 0;
    score = 0;
    scoreElement.textContent = score;
    randomFood();
    drawGame();
});

document.addEventListener('keydown', changeDirection);
randomFood();
drawGame();
}

// Cloaking Toggle Control
const cloakToggle = document.getElementById('cloakToggle');
if (cloakToggle) {
    // Check current state
    const isCloakingEnabled = localStorage.getItem('autoCloak') === 'true';
    if (isCloakingEnabled) {
        cloakToggle.classList.add('active');
        cloakToggle.textContent = '🔓';
    }
    
    cloakToggle.addEventListener('click', function() {
        if (window.titaniumCloak || window.platinumCloak) {
            const cloak = window.titaniumCloak || window.platinumCloak;
            const isEnabled = localStorage.getItem('autoCloak') === 'true';
            if (isEnabled) {
                cloak.disable();
                this.classList.remove('active');
                this.textContent = '🔒';
            } else {
                cloak.enable();
                this.classList.add('active');
                this.textContent = '🔓';
            }
        }
    });
}

// Game Modal functionality
let gameModal, gameModalFrame, gameModalTitle, gameCloseBtn, gameFullscreenBtn, gameNewTabBtn;
let currentGameUrl = '';

// Global handler function for onclick attributes - must be available immediately
window.handleGameCardClick = function(card) {
    console.log('handleGameCardClick called!', card);
    
    const gameFile = card.getAttribute('data-game');
    const gameName = card.querySelector('h3')?.textContent || 'Game';
    const gameUrl = `games/${gameFile}`;
    
    console.log('Opening game:', {
        gameFile,
        gameName,
        gameUrl,
        openGameModal: typeof window.openGameModal
    });
    
    if (window.openGameModal) {
        window.openGameModal(gameUrl, gameName);
    } else {
        console.error('openGameModal not available, redirecting');
        window.location.href = gameUrl;
    }
};

function initGameModal() {
    gameModal = document.getElementById('gameModal');
    gameModalFrame = document.getElementById('gameModalFrame');
    gameModalTitle = document.getElementById('gameModalTitle');
    gameCloseBtn = document.getElementById('gameCloseBtn');
    gameFullscreenBtn = document.getElementById('gameFullscreenBtn');
    gameNewTabBtn = document.getElementById('gameNewTabBtn');

    function openGameModal(gameUrl, gameName) {
        if (!gameModal) {
            console.error('Game modal not found, redirecting to:', gameUrl);
            window.location.href = gameUrl;
            return;
        }
        
        currentGameUrl = gameUrl;
        if (gameModalTitle) gameModalTitle.textContent = gameName || 'Game';
        if (gameModalFrame) gameModalFrame.src = gameUrl;
        gameModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeGameModal() {
        if (!gameModal) return;
        gameModal.style.display = 'none';
        if (gameModalFrame) gameModalFrame.src = 'about:blank';
        document.body.style.overflow = '';
        gameModal.classList.remove('fullscreen');
    }

    // Always set these functions on window, even if modal doesn't exist
    window.openGameModal = openGameModal;
    window.closeGameModal = closeGameModal;

    if (!gameModal) {
        console.warn('Game modal elements not found on this page');
        return;
    }

    if (gameCloseBtn) {
        gameCloseBtn.addEventListener('click', closeGameModal);
    }

    if (gameFullscreenBtn) {
        gameFullscreenBtn.addEventListener('click', function() {
            gameModal.classList.toggle('fullscreen');
            if (gameModal.classList.contains('fullscreen')) {
                this.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>';
            } else {
                this.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
            }
        });
    }

    if (gameNewTabBtn) {
        gameNewTabBtn.addEventListener('click', function() {
            if (currentGameUrl) {
                window.open(currentGameUrl, '_blank');
            }
        });
    }

    // Close modal on background click
    gameModal.addEventListener('click', function(e) {
        if (e.target === gameModal) {
            closeGameModal();
        }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && gameModal && gameModal.style.display !== 'none') {
            closeGameModal();
        }
    });
}

// Game card click handlers - attach directly to each card
function setupGameCardHandlers() {
    const gameCards = document.querySelectorAll('.game-card[data-game]');
    console.log('Setting up handlers for', gameCards.length, 'game cards');
    
    gameCards.forEach((card, index) => {
        // Make sure card is visible and clickable
        card.style.cursor = 'pointer';
        card.style.pointerEvents = 'auto';
        
        // Attach click handler directly (in addition to onclick)
        card.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.handleGameCardClick(this);
        }, false);
    });
    
    console.log('Game card handlers attached to', gameCards.length, 'cards');
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded fired');
    
    // Initialize modal first
    initGameModal();
    console.log('Modal initialized, openGameModal:', typeof window.openGameModal);
    
    // Setup game card handlers immediately
    setupGameCardHandlers();
    
    // Also try again after a short delay in case cards aren't ready
    setTimeout(() => {
        console.log('Retrying game card handler setup');
        setupGameCardHandlers();
    }, 500);
});

// Also setup for dynamically loaded content
const gameCardObserver = new MutationObserver(function(mutations) {
    let shouldSetup = false;
    mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1 && (node.classList?.contains('game-card') || node.querySelector?.('.game-card'))) {
                    shouldSetup = true;
                }
            });
        }
    });
    if (shouldSetup) {
        setupGameCardHandlers();
    }
});

// Observe for new game cards being added
if (document.body) {
    gameCardObserver.observe(document.body, { childList: true, subtree: true });
}
