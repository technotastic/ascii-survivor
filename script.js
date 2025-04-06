// --- Game Constants ---
const TARGET_FPS = 60;
const TARGET_FRAME_TIME = 1000 / TARGET_FPS;
const XP_ORB_CHAR = '*';
const PLAYER_CHAR = '@';
const PLAYER_SPEED = 0.15;
const PLAYER_INITIAL_HEALTH = 100;
const PLAYER_INVINCIBILITY_DURATION = 600; // ms after taking damage
const ENEMY_SPAWN_INTERVAL_START = 1400; // ms
const ENEMY_SPAWN_INTERVAL_MIN = 150; // ms
const ENEMY_SPAWN_SCALING_FACTOR = 0.992; // Multiplier per second
const SCORE_PER_SECOND = 10;
const SCORE_PER_KILL = 50;
const HIGH_SCORE_KEY = 'asciiSurvivorHighScores_v2'; // Use new key if format changed
const MAX_HIGH_SCORES = 5;
const BACKGROUND_CHAR = '.';

// --- Game State Variables ---
let screenWidthChars = 80;
let screenHeightChars = 24;
let player = {};
let enemies = [];
let projectiles = [];
let xpOrbs = [];
let activeWeapons = [];
let gameTime = 0; // in milliseconds
let score = 0;
let level = 1;
let xp = 0;
let xpToNextLevel = 100;
let isGameOver = false;
let isPaused = false;
let isLevelUp = false;
let isInvincible = false;
let invincibilityTimer = 0;
let lastFrameTime = 0;
let gameLoopId = null;
let enemySpawnTimer = 0;
let currentEnemySpawnInterval = ENEMY_SPAWN_INTERVAL_START;
let highScores = [];
let resizeTimeout; // For debouncing resize

// Input State
const keysPressed = {};
let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let touchCurrentY = 0;
let isTouching = false;
let touchIdentifier = null; // To track a specific touch

// --- DOM Element Caching (Defined early, assuming 'defer' ensures they exist when needed) ---
// These are assigned after the DOM loads, but declared here for scope access.
let gameContainer, gameScreen, uiOverlay, timerDisplay, hpValueDisplay, maxHpValueDisplay, healthBarFill, levelValueDisplay, xpBarFill, scoreDisplay;
let splashScreen, startButton, splashHighScores;
let levelUpScreen, levelUpOptionsContainer;
let gameOverScreen, finalTimeDisplay, finalScoreDisplay, restartButton, gameOverHighScores;
let pauseScreen, resumeButton, quitButton, pauseButton;
let touchControls, touchStick;


// --- Utility Functions ---
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const distance = (x1, y1, x2, y2) => Math.sqrt((x1 - x2)**2 + (y1 - y2)**2);
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

// --- Entity Definitions & Data ---

const WEAPON_DATA = {
    'Dagger': {
        name: 'Dagger', char: '-', projectileChar: "'", projectileClass: 'projectile-dagger',
        baseDamage: 10, baseCooldown: 800, baseProjectileSpeed: 0.4, maxLevel: 5,
        description: "Fires a sharp projectile towards movement/target.",
        levelUpDescriptions: ["Damage +5", "Cooldown -100ms", "Damage +10", "Cooldown -150ms", "Damage +15"],
        levelUpFn: (w) => { const l=w.level; if(l===2)w.damage+=5; else if(l===3)w.cooldown-=100; else if(l===4)w.damage+=10; else if(l===5)w.cooldown-=150; else if(l===6)w.damage+=15; },
        fireFn: (weapon) => {
            let targetEnemy=null, minDist=15*player.areaSizeBoost; enemies.forEach(e=>{const d=distance(player.x,player.y,e.x,e.y); if(d<minDist){minDist=d;targetEnemy=e;}});
            let dx=0, dy=0; if(targetEnemy){dx=targetEnemy.x-player.x; dy=targetEnemy.y-player.y;} else {dx=player.lastMoveDx!==0?player.lastMoveDx:1; dy=player.lastMoveDy!==0?player.lastMoveDy:0;} // Use last move direction as fallback
            const mag=Math.sqrt(dx*dx+dy*dy); if(mag>0){dx/=mag;dy/=mag;} else {dx=1;dy=0;} // Default right if magnitude is 0
            projectiles.push({x:player.x+dx*0.6,y:player.y+dy*0.6,vx:dx*weapon.projectileSpeed*player.projectileSpeedBoost,vy:dy*weapon.projectileSpeed*player.projectileSpeedBoost,char:weapon.projectileChar,damage:weapon.damage*player.damageBoost,lifetime:1500,piercing:false,cssClass:weapon.projectileClass});
        }
    },
    'Garlic Aura': {
        name: 'Garlic Aura', char: '%', baseDamage: 3, baseCooldown: 500, baseRadius: 3.0, maxLevel: 5,
        description: "Damages nearby enemies periodically.",
        levelUpDescriptions: ["Radius +0.5", "Damage +2", "Radius +0.75", "Damage +3", "Radius +1.0"],
        levelUpFn: (w) => { const l=w.level; if(l===2)w.radius+=0.5; else if(l===3)w.damage+=2; else if(l===4)w.radius+=0.75; else if(l===5)w.damage+=3; else if(l===6)w.radius+=1.0; },
        fireFn: () => { /* Damage applied in checkCollisions based on cooldown timing */ },
        isAreaEffect: true, cssClass: 'effect-aura'
    },
    'Spinning Spikes': {
        name: 'Spinning Spikes', char: '*', projectileChar: "+", projectileClass: 'projectile-spike',
        baseDamage: 8, baseCooldown: 1500, baseProjectileSpeed: 0.2, numProjectiles: 4, maxLevel: 5,
        description: "Launches spikes radially that rotate slowly.",
        levelUpDescriptions: ["+1 Spike", "Damage +4", "Cooldown -200ms", "+1 Spike", "Damage +6"],
        levelUpFn: (w) => { const l=w.level; if(l===2)w.numProjectiles+=1; else if(l===3)w.damage+=4; else if(l===4)w.cooldown-=200; else if(l===5)w.numProjectiles+=1; else if(l===6)w.damage+=6; },
        fireFn: (weapon) => {
            const angleInc=(Math.PI*2)/weapon.numProjectiles;
            for(let i=0;i<weapon.numProjectiles;i++){ const angle=i*angleInc+(gameTime/3000); const dx=Math.cos(angle); const dy=Math.sin(angle); // Slower rotation
                projectiles.push({x:player.x+dx*0.6,y:player.y+dy*0.6,vx:dx*weapon.projectileSpeed*player.projectileSpeedBoost,vy:dy*weapon.projectileSpeed*player.projectileSpeedBoost,char:weapon.projectileChar,damage:weapon.damage*player.damageBoost,lifetime:1200,piercing:false,cssClass:weapon.projectileClass});
            }
        }
    }
};

const STAT_BOOST_DATA = {
    'Max Health': { name: 'Max Health +20%', description: "Increases max health by 20%.", applyFn: () => { const r=player.health/player.maxHealth; player.maxHealth=Math.round(player.maxHealth*1.2); player.health=Math.round(player.maxHealth*r); }},
    'Move Speed': { name: 'Move Speed +10%', description: "Increases movement speed by 10%.", applyFn: () => { player.speed*=1.1; }},
    'Damage Boost': { name: 'Damage +15%', description: "Increases all weapon damage by 15%.", applyFn: () => { player.damageBoost*=1.15; }},
    'Cooldown Reduction': { name: 'Cooldown -10%', description: "Reduces weapon cooldowns by 10%.", applyFn: () => { player.cooldownReduction*=0.9; }},
    'Pickup Radius': { name: 'Pickup Radius +25%', description: "Increases XP orb collection radius.", applyFn: () => { player.pickupRadius*=1.25; }},
    'Heal 30%': { name: 'Heal 30%', description: "Restores 30% of maximum health.", applyFn: () => { player.health = Math.min(player.maxHealth, player.health + Math.round(player.maxHealth * 0.3)); }}
};

const ENEMY_TYPES = [
    { char: 'e', cssClass: 'enemy-e', health: 20, speed: 0.04, damage: 10, xp: 10, spawnTimeMin: 0 },
    { char: 'o', cssClass: 'enemy-o', health: 15, speed: 0.07, damage: 8, xp: 15, spawnTimeMin: 30 },
    { char: 'X', cssClass: 'enemy-X', health: 80, speed: 0.03, damage: 20, xp: 50, spawnTimeMin: 120 }
];


// --- Core Game Logic Functions ---

function initGame() {
    console.log("initGame: Initializing Game...");
    // Assign DOM elements now that the script runs deferred
    assignDOMElements();

    // Check if essential elements were found
    if (!gameContainer || !gameScreen || !splashScreen) {
        console.error("initGame: Critical DOM elements missing AFTER defer. Aborting initialization.");
        alert("Error: Core game elements not found. Cannot initialize game.");
        return;
    }

    resizeGameScreen(); // Set screen size first

    player = {
        x: Math.floor(screenWidthChars / 2), y: Math.floor(screenHeightChars / 2),
        char: PLAYER_CHAR, cssClass: 'player', speed: PLAYER_SPEED,
        health: PLAYER_INITIAL_HEALTH, maxHealth: PLAYER_INITIAL_HEALTH,
        pickupRadius: 2.5, damageBoost: 1.0, cooldownReduction: 1.0,
        projectileSpeedBoost: 1.0, areaSizeBoost: 1.0,
        lastMoveDx: 1, lastMoveDy: 0, // Initialize last move direction
    };

    enemies = []; projectiles = []; xpOrbs = []; activeWeapons = [];
    addWeapon('Dagger'); // Add initial weapon AFTER resetting activeWeapons array

    gameTime = 0; score = 0; level = 1; xp = 0; xpToNextLevel = 100;
    isGameOver = false; isPaused = false; isLevelUp = false; isInvincible = false;
    invincibilityTimer = 0; enemySpawnTimer = 0;
    currentEnemySpawnInterval = ENEMY_SPAWN_INTERVAL_START;

    updateUI(); // Reset UI elements

    // Hide overlay screens, show game area
    splashScreen.style.display = 'none';
    if(levelUpScreen) levelUpScreen.style.display = 'none';
    if(gameOverScreen) gameOverScreen.style.display = 'none';
    if(pauseScreen) pauseScreen.style.display = 'none';
    gameContainer.style.display = 'block';
    if(pauseButton) pauseButton.textContent = 'Pause'; // Ensure mobile pause button is reset


    // Start game loop
    lastFrameTime = performance.now();
    if (gameLoopId) cancelAnimationFrame(gameLoopId); // Clear any previous loop
    gameLoopId = requestAnimationFrame(gameLoop);
    console.log("initGame: Game Started Successfully!");
}

function assignDOMElements() {
    gameContainer = document.getElementById('gameContainer');
    gameScreen = document.getElementById('gameScreen');
    uiOverlay = document.getElementById('uiOverlay');
    timerDisplay = document.getElementById('timer');
    hpValueDisplay = document.getElementById('hpValue');
    maxHpValueDisplay = document.getElementById('maxHpValue');
    healthBarFill = document.getElementById('healthBarFill');
    levelValueDisplay = document.getElementById('levelValue');
    xpBarFill = document.getElementById('xpBarFill');
    scoreDisplay = document.getElementById('score');
    splashScreen = document.getElementById('splashScreen');
    startButton = document.getElementById('startButton');
    splashHighScores = document.getElementById('splashHighScores');
    levelUpScreen = document.getElementById('levelUpScreen');
    levelUpOptionsContainer = document.getElementById('levelUpOptions');
    gameOverScreen = document.getElementById('gameOverScreen');
    finalTimeDisplay = document.getElementById('finalTime');
    finalScoreDisplay = document.getElementById('finalScore');
    restartButton = document.getElementById('restartButton');
    gameOverHighScores = document.getElementById('gameOverHighScores');
    pauseScreen = document.getElementById('pauseScreen');
    resumeButton = document.getElementById('resumeButton');
    quitButton = document.getElementById('quitButton');
    pauseButton = document.getElementById('pauseButton');
    touchControls = document.getElementById('touchControls');
    touchStick = document.getElementById('touchStick');
    console.log("DOM Elements Assigned.");
}


function resizeGameScreen() {
    if (!gameScreen || !gameContainer) {
        console.warn("resizeGameScreen called before elements are ready.");
        return;
    }

    // Estimate character size (consider moving to a one-time calculation if font doesn't change)
    const tempSpan=document.createElement('span'); tempSpan.style.fontFamily="'Courier New', Courier, monospace"; tempSpan.style.fontSize='16px'; tempSpan.style.position='absolute'; tempSpan.style.visibility='hidden'; tempSpan.textContent='W'; document.body.appendChild(tempSpan);
    const charWidth=tempSpan.offsetWidth; const charHeight=tempSpan.offsetHeight; document.body.removeChild(tempSpan);
    const safeCharWidth=charWidth>1?charWidth:9.6; const safeCharHeight=charHeight>1?charHeight:16; // Ensure non-zero defaults

    const availableWidth=window.innerWidth-30; const availableHeight=window.innerHeight-60; // Approx available space
    screenWidthChars=Math.max(30, Math.floor(availableWidth/safeCharWidth));
    screenHeightChars=Math.max(15, Math.floor(availableHeight/safeCharHeight));

    gameScreen.style.width=`${screenWidthChars*safeCharWidth}px`; gameScreen.style.height=`${screenHeightChars*safeCharHeight}px`;
    gameContainer.style.width=gameScreen.style.width; gameContainer.style.height=gameScreen.style.height;
    // console.log(`Resized screen to ${screenWidthChars}x${screenHeightChars} chars`); // Optional log
}

function getPlayerInput(deltaTime) {
    let dx=0, dy=0;
    if (!player || !player.speed) return { dx: 0, dy: 0 }; // Guard against player not existing yet

    const moveSpeed=player.speed*(deltaTime/TARGET_FRAME_TIME);

    // Keyboard
    if(keysPressed['w']||keysPressed['arrowup'])dy-=1; if(keysPressed['s']||keysPressed['arrowdown'])dy+=1; if(keysPressed['a']||keysPressed['arrowleft'])dx-=1; if(keysPressed['d']||keysPressed['arrowright'])dx+=1;

    // Touch (Overrides Keyboard if active)
    if(isTouching){
        const tDX=touchCurrentX-touchStartX; const tDY=touchCurrentY-touchStartY;
        const dist=Math.sqrt(tDX*tDX+tDY*tDY); const deadZone=15;
        if(dist>deadZone){dx=tDX/dist; dy=tDY/dist;} else {dx=0;dy=0;} // Inside deadzone, no movement from touch
    }

    // Normalize diagonal
    if(dx!==0&&dy!==0){const mag=Math.sqrt(2); dx/=mag; dy/=mag;}

    // Store last non-zero direction for weapon aiming etc.
    if(dx!==0||dy!==0){player.lastMoveDx=dx; player.lastMoveDy=dy;}

    return {dx:dx*moveSpeed, dy:dy*moveSpeed};
}


// --- Entity Creation / Modification ---

function createWeaponInstance(weaponName) {
    const data = WEAPON_DATA[weaponName];
    if (!data) return null;
    // Create a fresh copy of the weapon data
    return {
        name: data.name, level: 0, maxLevel: data.maxLevel,
        damage: data.baseDamage, cooldown: data.baseCooldown, lastFired: 0,
        projectileChar: data.projectileChar, projectileSpeed: data.baseProjectileSpeed,
        projectileClass: data.projectileClass, radius: data.baseRadius, numProjectiles: data.numProjectiles,
        isAreaEffect: data.isAreaEffect || false,
        // Make sure to copy functions if they are defined on the base object,
        // or reference them directly as they are stateless here.
        levelUpFn: data.levelUpFn, fireFn: data.fireFn,
        description: data.description, levelUpDescriptions: data.levelUpDescriptions || []
    };
}

 function addWeapon(weaponName) {
     let weapon = activeWeapons.find(w => w.name === weaponName);
     if (weapon) { // Level up existing
         if (weapon.level < weapon.maxLevel) {
             weapon.level++;
             if (weapon.levelUpFn) weapon.levelUpFn(weapon); // Apply stats for the new level
             console.log(`Leveled up ${weapon.name} to level ${weapon.level}`);
         } else { console.log(`${weapon.name} is already max level!`); }
     } else { // Add new
         const newWeapon = createWeaponInstance(weaponName);
         if (newWeapon) {
            newWeapon.level = 1; // Set level to 1 when first added
            activeWeapons.push(newWeapon);
            console.log(`Added new weapon: ${weaponName}`);
         }
     }
     // updateUI(); // Only needed if UI shows weapon details
 }

function spawnEnemy() {
    const currentTimeSeconds = gameTime / 1000;
    const availableTypes = ENEMY_TYPES.filter(type => currentTimeSeconds >= type.spawnTimeMin);
    if (availableTypes.length === 0) return;

    const type = availableTypes[randInt(0, availableTypes.length - 1)];
    let x,y; const side = randInt(1, 4); const buffer = 3; // Spawn further outside

    if(side===1){x=rand(-buffer,screenWidthChars+buffer);y=-buffer;}else if(side===2){x=screenWidthChars+buffer;y=rand(-buffer,screenHeightChars+buffer);}else if(side===3){x=rand(-buffer,screenWidthChars+buffer);y=screenHeightChars+buffer;}else{x=-buffer;y=rand(-buffer,screenHeightChars+buffer);}

    // Scale enemy stats based on time
    const healthMultiplier = 1 + Math.max(0, (currentTimeSeconds - 30) / 500); // +1% health per 5 seconds after 30s
    const speedMultiplier = 1 + Math.max(0, (currentTimeSeconds - 60) / 1500); // +1% speed per 15 seconds after 60s

    enemies.push({
        ...type, // Copy base type properties
        health: Math.round(type.health * healthMultiplier),
        maxHealth: Math.round(type.health * healthMultiplier), // Store max health too
        speed: type.speed * speedMultiplier, // Apply scaled speed
        x: x, y: y,
        id: Math.random().toString(36).substring(2, 9) // Unique ID
    });
}

function createXPOrb(x, y, value) {
    xpOrbs.push({ x, y, value, char: XP_ORB_CHAR, cssClass: 'xp-orb' });
}

// --- Update Functions ---

function updatePlayer(deltaTime, input) {
    if (!player || player.x === undefined) return; // Guard against player not existing
    player.x += input.dx; player.y += input.dy;
    player.x = clamp(player.x, 0, screenWidthChars - 1); player.y = clamp(player.y, 0, screenHeightChars - 1);

    // Handle invincibility visual state
    if (isInvincible) {
        invincibilityTimer -= deltaTime;
        if (invincibilityTimer <= 0) { isInvincible = false; player.cssClass = 'player'; }
         else { player.cssClass = (Math.floor(performance.now() / 100) % 2 === 0) ? 'player-invincible' : 'player'; }
    } else { player.cssClass = 'player'; }

    // XP Orb Magnetism & Collection (Iterate backwards for safe splicing)
    for (let i = xpOrbs.length - 1; i >= 0; i--) {
         const orb = xpOrbs[i];
         const d = distance(player.x, player.y, orb.x, orb.y);
         if (d < 1.0) { collectXP(orb.value); xpOrbs.splice(i, 1); continue; } // Direct pickup
         if (d < player.pickupRadius) { // Magnetism
             const speed = 0.35 * (deltaTime / TARGET_FRAME_TIME);
             const moveX = ((player.x - orb.x) / d) * speed; const moveY = ((player.y - orb.y) / d) * speed;
             orb.x += moveX; orb.y += moveY;
         }
     }
}

function updateEnemies(deltaTime) {
    const moveSpeedFactor = deltaTime / TARGET_FRAME_TIME;
    for (let i = enemies.length - 1; i >= 0; i--) { // Iterate backwards for safe splicing during collisions
        const enemy = enemies[i];
        const dx = player.x - enemy.x; const dy = player.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.5) { // Avoid division by zero and jitter when close
            const moveX = (dx / dist) * enemy.speed * moveSpeedFactor; const moveY = (dy / dist) * enemy.speed * moveSpeedFactor;
            enemy.x += moveX; enemy.y += moveY;
        }
    }
}

 function updateWeapons(deltaTime) {
    activeWeapons.forEach(weapon => {
        const currentCooldown = weapon.cooldown * player.cooldownReduction;
        weapon.lastFired += deltaTime; // Always increment timer

        // Check if cooldown is complete
        if (weapon.lastFired >= currentCooldown) {
            if (!weapon.isAreaEffect) { // Projectile weapons fire when ready
                weapon.fireFn(weapon);
            }
            // For area effects, this marks the moment the damage tick should apply (checked in collisions)
            // For projectiles, this resets the timer after firing
            weapon.lastFired = 0; // Reset timer completely after firing/tick check
            // Alternatively: weapon.lastFired -= currentCooldown; // Allows catching up if delta > cooldown
        }
    });
}

function updateProjectiles(deltaTime) {
    const moveSpeedFactor = deltaTime / TARGET_FRAME_TIME;
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.x += p.vx * moveSpeedFactor; p.y += p.vy * moveSpeedFactor;
        p.lifetime -= deltaTime;
        const buffer = 5; // Allow travel slightly offscreen
        if (p.lifetime <= 0 || p.x < -buffer || p.x > screenWidthChars + buffer || p.y < -buffer || p.y > screenHeightChars + buffer) {
            projectiles.splice(i, 1);
        }
    }
}

function updateDifficulty(deltaTime) {
    // Spawn rate scales (faster initially, then slows down relative increase)
    const scaleFactor = ENEMY_SPAWN_SCALING_FACTOR ** (deltaTime / 1000);
    currentEnemySpawnInterval = Math.max(ENEMY_SPAWN_INTERVAL_MIN, currentEnemySpawnInterval * scaleFactor);

    // Spawn enemies based on interval
    enemySpawnTimer += deltaTime;
    if (enemySpawnTimer >= currentEnemySpawnInterval) {
         const timeMinutes = gameTime / (60 * 1000);
         const additionalSpawns = Math.floor(timeMinutes / 2.5); // +1 enemy every 2.5 minutes (adjust as needed)
         const spawnCount = 1 + additionalSpawns;
         for (let i = 0; i < spawnCount; i++) {
             spawnEnemy();
         }
        enemySpawnTimer = 0; // Reset timer
    }
}

// --- Collision & Damage ---

function checkCollisions() {
    if (!player || player.x === undefined) return; // Guard

    // Player vs Enemy
     if (!isInvincible) {
         for (let i = enemies.length - 1; i >= 0; i--) {
             const enemy = enemies[i];
             if (distance(player.x, player.y, enemy.x, enemy.y) < 0.8) { // Collision radius
                 takeDamage(enemy.damage);
                 if (isGameOver) return; // Stop collision checks if player died
                 break; // Player can only take one hit per collision check frame
             }
         }
    }

    // Projectile vs Enemy
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (!p) continue; // Safety check in case of race condition
        let projectileRemoved = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
            const enemy = enemies[j];
            if (distance(p.x, p.y, enemy.x, enemy.y) < 0.9) { // Projectile hit radius
                const killed = dealDamageToEnemy(enemy, p.damage, j); // Use helper, pass index
                if (!p.piercing) { // Remove non-piercing projectiles on hit
                    projectiles.splice(i, 1);
                    projectileRemoved = true;
                    break; // Projectile is gone, stop checking it against other enemies
                } else if (killed) {
                    // Optional: Implement pierce count reduction here if needed
                }
            }
        }
        if (projectileRemoved) continue; // Move to next projectile if this one was removed
    }

     // Area Effect Weapon Damage (e.g., Garlic Aura)
    activeWeapons.forEach(weapon => {
        // Apply damage IF it's an area effect AND its cooldown just completed this frame (lastFired is near 0)
        if (weapon.isAreaEffect && weapon.lastFired < TARGET_FRAME_TIME) {
            const effectRadius = weapon.radius * player.areaSizeBoost;
            const damage = weapon.damage * player.damageBoost;
            for (let j = enemies.length - 1; j >= 0; j--) { // Iterate backwards through enemies
                 const enemy = enemies[j];
                 if (distance(player.x, player.y, enemy.x, enemy.y) < effectRadius) {
                     dealDamageToEnemy(enemy, damage, j); // Use helper function
                 }
            }
        }
    });
}

// Helper function to handle dealing damage and removing enemies
function dealDamageToEnemy(enemy, damageAmount, enemyIndex) {
     enemy.health -= damageAmount;
     // TODO: Add damage number effect?

    if (enemy.health <= 0) {
        createXPOrb(enemy.x, enemy.y, enemy.xp); // Create XP orb at enemy location
        score += SCORE_PER_KILL;
        enemies.splice(enemyIndex, 1); // Remove enemy using the provided index
        return true; // Enemy was killed
    }
    return false; // Enemy survived
}

 function takeDamage(amount) {
    if (isInvincible || isGameOver) return; // Can't take damage if invincible or game over

    player.health -= amount;
    score = Math.max(0, score - amount * 5); // Lose a bit of score on hit (optional penalty)
    // TODO: Add visual/audio feedback for taking damage (screen flash, sound)

    if (player.health <= 0) {
        player.health = 0;
        updateUI(); // Update UI one last time to show 0 health
        gameOver();
    } else {
         isInvincible = true; // Grant invincibility frames
         invincibilityTimer = PLAYER_INVINCIBILITY_DURATION;
         // Visual flashing is handled by player.cssClass update in updatePlayer
         updateUI(); // Update health display immediately
    }
}

// --- XP & Leveling ---

function collectXP(amount) {
    if (isGameOver) return; // Don't collect XP after game over
    xp += amount;
    score += Math.round(amount * 1.5); // Grant some score for XP collection

    // Check for level up ONLY if not already in the level up screen
    if (xp >= xpToNextLevel && !isLevelUp) {
        levelUp();
    }
    updateUI();
}

function levelUp() {
    isLevelUp = true; isPaused = true; // Enter level up state, pause game
    level++;
    xp -= xpToNextLevel; // Subtract cost, carry over excess XP
    xpToNextLevel = Math.floor(xpToNextLevel * 1.5 + 50); // Increase XP needed for next level

    console.log(`Level Up! Reached level ${level}. XP to next: ${xpToNextLevel}`);
    generateLevelUpOptions();
    if (levelUpScreen) {
        levelUpScreen.style.display = 'flex'; // Show level up screen
    } else {
        console.error("Level up screen element not found!");
        // If screen missing, maybe auto-resume or show alert? For now, game stays paused.
    }
    updateUI(); // Update level display etc.
}

function generateLevelUpOptions() {
    if (!levelUpOptionsContainer) {
        console.error("Level up options container not found!");
        return;
    }
    levelUpOptionsContainer.innerHTML = ''; // Clear previous options
    let options = []; // *** CRITICAL FIX: Use 'let' not 'const' ***
    const maxOptions = 3;

    // Create pools of available options dynamically each time
    let availableWeaponLevels = activeWeapons.filter(w => w.level < w.maxLevel);
    let availableNewWeaponsList = Object.keys(WEAPON_DATA).filter(name => !activeWeapons.some(w => w.name === name));
    let availableStatBoostsList = Object.keys(STAT_BOOST_DATA);
    // Don't offer heal if player is at full health
    if (player.health >= player.maxHealth) {
        availableStatBoostsList = availableStatBoostsList.filter(b => b !== 'Heal 30%');
    }

    let attempts = 0;
    const chosenOptionSignatures = new Set(); // Track options offered *this time* to avoid duplicates

    while (options.length < maxOptions && attempts < 20) {
        attempts++;
        const choicePool = []; // Determine possible categories for this choice
        if (availableWeaponLevels.length > 0) choicePool.push('levelWeapon');
        if (availableNewWeaponsList.length > 0) choicePool.push('newWeapon');
        if (availableStatBoostsList.length > 0) choicePool.push('statBoost');
        if (choicePool.length === 0) break; // Exit if no more options exist

        const choiceType = choicePool[randInt(0, choicePool.length - 1)];
        let option = null;
        let tempAvailableIndex = -1; // To correctly remove chosen item from temp list

        try { // Wrap option generation in try-catch for safety
            if (choiceType === 'levelWeapon') {
                tempAvailableIndex = randInt(0, availableWeaponLevels.length - 1);
                const weapon = availableWeaponLevels[tempAvailableIndex];
                const levelIndex = weapon.level; // Desc is for the level player is *reaching* (level is 1-based index for descriptions array)
                const desc = weapon.levelUpDescriptions[levelIndex -1] || `Upgrade`; // Use level-1 for 0-based array index
                option = { text: `${weapon.name} (Lvl ${weapon.level + 1}) - ${desc}`, action: () => addWeapon(weapon.name), signature: `level_${weapon.name}` };
            } else if (choiceType === 'newWeapon') {
                 tempAvailableIndex = randInt(0, availableNewWeaponsList.length - 1);
                 const weaponName = availableNewWeaponsList[tempAvailableIndex];
                 const weaponData = WEAPON_DATA[weaponName];
                 option = { text: `New: ${weaponName} - ${weaponData.description}`, action: () => addWeapon(weaponName), signature: `new_${weaponName}` };
            } else if (choiceType === 'statBoost') {
                 tempAvailableIndex = randInt(0, availableStatBoostsList.length - 1);
                 const boostName = availableStatBoostsList[tempAvailableIndex];
                 const boostData = STAT_BOOST_DATA[boostName];
                 option = { text: `${boostData.name} - ${boostData.description}`, action: boostData.applyFn, signature: `boost_${boostName}` };
            }
        } catch (error) { console.error("Error generating level up option detail:", error, "Type:", choiceType); continue; } // Skip this attempt on error

        // Add option if it's valid and not a duplicate on this screen; remove from temp pool
        if (option && !chosenOptionSignatures.has(option.signature)) {
            options.push(option);
            chosenOptionSignatures.add(option.signature);
            // Remove the chosen option from its temporary list to prevent re-offering *this time*
            if (choiceType === 'levelWeapon') availableWeaponLevels.splice(tempAvailableIndex, 1);
            else if (choiceType === 'newWeapon') availableNewWeaponsList.splice(tempAvailableIndex, 1);
            else if (choiceType === 'statBoost') {
                 // Don't remove Heal from the available pool permanently, but remove others for this specific selection round
                 if (option.signature !== 'boost_Heal 30%') {
                     availableStatBoostsList.splice(tempAvailableIndex, 1);
                 }
            }
        } else if (option && chosenOptionSignatures.has(option.signature)) {
            // Optional: Log if a duplicate was skipped
             // console.log("Skipped duplicate level up option:", option.signature);
            attempts--; // Don't penalize attempts count for duplicate skips
        }
    }

    // Fallback if no options generated (should be rare)
    if (options.length === 0) {
        console.warn("No valid level up options generated, adding fallback.");
        options.push({
            text: "Max Health +10 (Fallback)",
            action: () => { player.maxHealth += 10; player.health += 10; },
            signature: "fallback_hp"
        });
    }

    // Create buttons for the selected options
    options.forEach(opt => {
        const button = document.createElement('button');
        button.classList.add('button');
        button.textContent = opt.text;
        button.onclick = () => {
            try { opt.action(); } // Apply the chosen upgrade
            catch (e) { console.error("Error applying level up action:", e); }
            finally { // Ensure game resumes even if action fails
                if(levelUpScreen) levelUpScreen.style.display = 'none';
                isLevelUp = false;
                resumeGame(); // Resume game after selection
            }
        };
        levelUpOptionsContainer.appendChild(button);
    });
}

// --- Rendering ---
function render() {
    if (!gameScreen) return; // Guard if called before element ready

    let screenHTML = '';
    const grid = {}; // Use object map for sparse grid { 'y_x': {char, class} }

    // Populate grid with entities (lower Z-index drawn first, higher overwrites)
    // XP Orbs
    xpOrbs.forEach(e => { const x = Math.round(e.x), y = Math.round(e.y); if (x >= 0 && x < screenWidthChars && y >= 0 && y < screenHeightChars) grid[`${y}_${x}`] = { char: e.char, cssClass: e.cssClass }; });
    // Projectiles
    projectiles.forEach(e => { const x = Math.round(e.x), y = Math.round(e.y); if (x >= 0 && x < screenWidthChars && y >= 0 && y < screenHeightChars) grid[`${y}_${x}`] = { char: e.char, cssClass: e.cssClass || 'projectile' }; });
    // Enemies
    enemies.forEach(e => { const x = Math.round(e.x), y = Math.round(e.y); if (x >= 0 && x < screenWidthChars && y >= 0 && y < screenHeightChars) grid[`${y}_${x}`] = { char: e.char, cssClass: e.cssClass }; });
    // Player (drawn last to be on top)
    if (player && player.x !== undefined) {
        const playerX = Math.round(player.x); const playerY = Math.round(player.y);
        if (playerX >= 0 && playerX < screenWidthChars && playerY >= 0 && playerY < screenHeightChars) {
            grid[`${playerY}_${playerX}`] = { char: PLAYER_CHAR, cssClass: player.cssClass }; // Use player's current class for invincibility flash
        }
    }

    // Build HTML string row by row from the grid map
    for (let y = 0; y < screenHeightChars; y++) {
        for (let x = 0; x < screenWidthChars; x++) {
             const key = `${y}_${x}`;
             if (grid[key]) { screenHTML += `<span class="${grid[key].cssClass}">${grid[key].char}</span>`; }
             else { screenHTML += BACKGROUND_CHAR; } // Background character
        }
        screenHTML += '\n'; // Newline after each row
    }

    // Update the pre tag content efficiently
    gameScreen.innerHTML = screenHTML;
}

// --- UI Updates ---
function updateUI() {
    // Guard checks ensure this doesn't error if called before elements are assigned OR player doesn't exist
    const playerExists = player && player.health !== undefined && player.maxHealth !== undefined;

    // Log current game state values relevant to bars
    // console.log(`UI Update - Health: ${playerExists ? player.health : 'N/A'}, MaxHealth: ${playerExists ? player.maxHealth : 'N/A'}, XP: ${xp}, XPNext: ${xpToNextLevel}`);

    if (timerDisplay) timerDisplay.textContent = `Time: ${formatTime(gameTime)}`;
    if (scoreDisplay) scoreDisplay.textContent = `Score: ${Math.floor(score)}`;

    const currentHealth = playerExists ? player.health : 0;
    const currentMaxHealth = playerExists ? player.maxHealth : 100; // Use 100 default if player !exist

    if (hpValueDisplay) hpValueDisplay.textContent = currentHealth;
    if (maxHpValueDisplay) maxHpValueDisplay.textContent = currentMaxHealth;
    if (levelValueDisplay) levelValueDisplay.textContent = level;

    // Health Bar update
    if (healthBarFill) { // Check if the element exists
        let healthPercent = 0; // Default to 0
        if (currentMaxHealth > 0) {
            healthPercent = Math.max(0, currentHealth / currentMaxHealth) * 100;
        }
        // Log the calculated percentage and the element itself right before setting
        // console.log(` > Updating Health Bar: Element found? ${!!healthBarFill}, Percent: ${healthPercent}%`);
        healthBarFill.style.width = `${healthPercent}%`; // Set the width style
        healthBarFill.style.backgroundColor = healthPercent > 60 ? 'lime' : healthPercent > 30 ? 'orange' : 'red';
    } else {
         // Only log error once if element consistently missing
         if (!window.healthBarMissingLogged) {
            console.error("ERROR: healthBarFill element NOT FOUND during UI update.");
            window.healthBarMissingLogged = true; // Prevent flooding console
         }
    }

     // XP Bar update
     if (xpBarFill) { // Check if the element exists
         let xpPercent = 0; // Default to 0
         if (xpToNextLevel > 0) {
             xpPercent = Math.max(0, xp / xpToNextLevel) * 100;
         }
          // Log the calculated percentage and the element itself
        // console.log(` > Updating XP Bar: Element found? ${!!xpBarFill}, Percent: ${xpPercent}%`);
         xpBarFill.style.width = `${xpPercent}%`; // Set the width style
     } else {
         // Only log error once if element consistently missing
         if (!window.xpBarMissingLogged) {
            console.error("ERROR: xpBarFill element NOT FOUND during UI update.");
            window.xpBarMissingLogged = true; // Prevent flooding console
         }
     }
}
    // Guard checks ensure this doesn't error if called before elements are assigned
    if (timerDisplay) timerDisplay.textContent = `Time: ${formatTime(gameTime)}`;
    if (scoreDisplay) scoreDisplay.textContent = `Score: ${Math.floor(score)}`;
    // Ensure player object exists before accessing its properties
    const currentHealth = (player && player.health !== undefined) ? player.health : '??';
    const currentMaxHealth = (player && player.maxHealth !== undefined) ? player.maxHealth : '??';
    if (hpValueDisplay) hpValueDisplay.textContent = currentHealth;
    if (maxHpValueDisplay) maxHpValueDisplay.textContent = currentMaxHealth;
    if (levelValueDisplay) levelValueDisplay.textContent = level;

    // Health Bar update
    if (healthBarFill && currentMaxHealth > 0) {
        const healthPercent = Math.max(0, currentHealth / currentMaxHealth) * 100;
        healthBarFill.style.width = `${healthPercent}%`;
        healthBarFill.style.backgroundColor = healthPercent > 60 ? 'lime' : healthPercent > 30 ? 'orange' : 'red';
    } else if (healthBarFill) { healthBarFill.style.width = '0%'; } // Handle zero max health case

     // XP Bar update
     if (xpBarFill && xpToNextLevel > 0) {
         const xpPercent = Math.max(0, xp / xpToNextLevel) * 100;
         xpBarFill.style.width = `${xpPercent}%`;
     } else if (xpBarFill) { xpBarFill.style.width = '0%'; 

     }


 // --- Game States ---
 function togglePause(showMenu) {
     if (isGameOver || isLevelUp) return; // Cannot pause during these states
     if (isPaused) { resumeGame(); }
     else { pauseGame(showMenu); }
 }

function pauseGame(showMenu=true) {
     if (isPaused) return; // Already paused
    isPaused = true;
    if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; } // Crucial: Stop the loop!
     if (showMenu && pauseScreen) {
         pauseScreen.style.display = 'flex';
         if(pauseButton) pauseButton.textContent = 'Resume'; // Update mobile button text
     }
     console.log("Game Paused.");
     // Reset touch stick visual state on pause, if touch controls exist
     if (touchControls && touchStick) {
        touchStick.style.transition = 'top 0.1s ease-out, left 0.1s ease-out';
        const cW=touchControls.clientWidth; const cH=touchControls.clientHeight;
        const sW=touchStick.clientWidth; const sH=touchStick.clientHeight;
        touchStick.style.left=`${(cW-sW)/2}px`; touchStick.style.top=`${(cH-sH)/2}px`;
     }
}

function resumeGame() {
    // Only resume if paused, and not if the level up screen should be active
    if (!isPaused || isLevelUp) return;
    isPaused = false;
    if(pauseScreen) pauseScreen.style.display = 'none';
    if(pauseButton) pauseButton.textContent = 'Pause'; // Reset mobile button text

    // Restart game loop
    lastFrameTime = performance.now(); // Reset frame time to avoid large jump
    if (!gameLoopId) { // Prevent duplicate loops if resume is called multiple times quickly
         gameLoopId = requestAnimationFrame(gameLoop);
    }
     console.log("Game Resumed.");
}

 function quitGame() {
     if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; } // Stop loop
     isGameOver = true; // Treat as game over for state consistency
     isTouching = false; // Stop touch processing

     // Hide game-related screens
     if(gameContainer) gameContainer.style.display = 'none';
     if(pauseScreen) pauseScreen.style.display = 'none';
     if(levelUpScreen) levelUpScreen.style.display = 'none';
     if(gameOverScreen) gameOverScreen.style.display = 'none'; // Hide game over if quitting from pause menu

     // Show splash screen
     if(splashScreen) splashScreen.style.display = 'flex';

     // Update high scores on splash screen
     if(splashHighScores) loadAndDisplayHighScores(splashHighScores);
     console.log("Game Quit.");
 }

function gameOver() {
     if (isGameOver) return; // Prevent multiple triggers
    console.log("Game Over!");
    isGameOver = true;
    isTouching = false; // Stop touch input
    if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; } // Stop loop

    // Update final stats display elements (check existence first)
    if (finalTimeDisplay) finalTimeDisplay.textContent = formatTime(gameTime);
    if (finalScoreDisplay) finalScoreDisplay.textContent = Math.floor(score);

    saveHighScore(Math.floor(score), formatTime(gameTime)); // Save score

    // Display scores on game over screen
    if (gameOverHighScores) loadAndDisplayHighScores(gameOverHighScores);

    // Hide game area, show game over screen
    if(gameContainer) gameContainer.style.display = 'none';
    if(gameOverScreen) gameOverScreen.style.display = 'flex';
}

// --- Persistence (High Scores) ---
function loadHighScores() {
    try {
        const storedScores = localStorage.getItem(HIGH_SCORE_KEY);
        highScores = storedScores ? JSON.parse(storedScores) : [];
        // Basic validation of loaded data
        if (!Array.isArray(highScores)) highScores = [];
        highScores = highScores.filter(s => typeof s === 'object' && s !== null && typeof s.score === 'number' && typeof s.time === 'string');
    } catch (e) { console.error("Could not load/parse high scores:", e); highScores = []; }
}

function saveHighScore(newScore, timeSurvived) {
     loadHighScores(); // Load current scores first
     const scoreEntry = { score: newScore, time: timeSurvived, date: new Date().toLocaleDateString() };
    highScores.push(scoreEntry);
    highScores.sort((a, b) => b.score - a.score); // Sort descending by score
    highScores = highScores.slice(0, MAX_HIGH_SCORES); // Keep only top N scores
    try { localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(highScores)); }
    catch (e) { console.error("Could not save high scores:", e); /* Handle potential storage errors */ }
}

function displayHighScores(listElement) {
    if (!listElement) return; // Don't try to display if element doesn't exist
    listElement.innerHTML = ''; // Clear existing list
    if (highScores.length === 0) { listElement.innerHTML = '<li>No scores yet!</li>'; }
    else {
        highScores.forEach((entry, index) => {
            const li = document.createElement('li');
            // Ensure date exists or provide fallback
            li.textContent = `${index + 1}. ${entry.score} pts (${entry.time}) - ${entry.date || '???'}`;
            listElement.appendChild(li);
        });
    }
}

function loadAndDisplayHighScores(listElement) {
     loadHighScores();
     displayHighScores(listElement); // Handles check if listElement is valid
}

// --- Game Loop ---
function gameLoop(currentTime) {
    // Request next frame immediately - ensures smooth animation timing
    gameLoopId = requestAnimationFrame(gameLoop);

    // --- State Checks ---
    // Stop processing if game ended or paused mid-frame
     if (isGameOver) {
         // Although cancelAnimationFrame is called in gameOver, double-check here
         if (gameLoopId) cancelAnimationFrame(gameLoopId);
         gameLoopId = null;
         return;
     }
    if (isPaused || isLevelUp) {
         lastFrameTime = currentTime; // Update time to prevent dt jump on resume
         return; // Skip updates and rendering, but keep requesting frames to check state
     }

    // --- Timing ---
    const deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
    // Avoid spiral of death if tab was inactive - clamp delta time
    const cappedDeltaTime = Math.min(deltaTime, TARGET_FRAME_TIME * 4); // Allow max 4x frame time skip (~16ms * 4 = 64ms)

    // --- Update ---
    gameTime += cappedDeltaTime;
    score += (SCORE_PER_SECOND / 1000) * cappedDeltaTime; // Add score over time

    const input = getPlayerInput(cappedDeltaTime);
    updatePlayer(cappedDeltaTime, input);
    updateEnemies(cappedDeltaTime);
    updateWeapons(cappedDeltaTime);
    updateProjectiles(cappedDeltaTime);
    checkCollisions(); // IMPORTANT: Check collisions AFTER movement/updates
    if (isGameOver) return; // Exit loop immediately if collisions caused game over

    updateDifficulty(cappedDeltaTime); // Update spawn rates etc.
    updateUI(); // Update displayed stats (relatively cheap)

    // --- Render ---
    render(); // Draw the current state
}

// --- Global Touch Handler Function (defined before use in listeners) ---
const touchEndOrCancel = (e) => {
    if(!isTouching || !touchControls || !touchStick) return; // Guard against missing elements or state
    let endedOurTouch=false;
    for(let i=0; i<e.changedTouches.length; i++){if(e.changedTouches[i].identifier===touchIdentifier){endedOurTouch=true; break;}}
    if(!endedOurTouch) return;

    isTouching=false; touchIdentifier=null;
    // Animate stick back to center
    touchStick.style.transition='top 0.1s ease-out, left 0.1s ease-out';
    const cW=touchControls.clientWidth; const cH=touchControls.clientHeight;
    const sW=touchStick.clientWidth; const sH=touchStick.clientHeight;
    touchStick.style.left=`${(cW-sW)/2}px`; touchStick.style.top=`${(cH-sH)/2}px`;
};

// --- Event Listener Setup Function ---
function setupInputListeners() {
    console.log("Setting up input listeners...");

    // Keyboard Listeners
    window.addEventListener('keydown',(e)=>{
        keysPressed[e.key.toLowerCase()]=true;
        // Handle pause toggle via keyboard
        if(!isGameOver&&!isLevelUp){ // Only allow pause if game is active
            if(e.key==='Escape'||e.key.toLowerCase()==='p'){
                togglePause(true); // Toggle pause with menu
            }
        }
    });
    window.addEventListener('keyup',(e)=>{keysPressed[e.key.toLowerCase()]=false;});

    // Touch Listeners (Joystick and Pause Button)
    if(touchControls && touchStick){
        touchControls.addEventListener('touchstart',(e)=>{
            if(isGameOver||isPaused||isLevelUp||isTouching)return; // Prevent multi-touch or activation when paused
            e.preventDefault();
            const touch=e.changedTouches[0]; const rect=touchControls.getBoundingClientRect();
            touchStartX=rect.left+rect.width/2; touchStartY=rect.top+rect.height/2;
            touchCurrentX=touch.clientX; touchCurrentY=touch.clientY;
            touchIdentifier=touch.identifier; isTouching=true;
            touchStick.style.transition='none'; // No animation while dragging
        },{passive:false});

        // Listen on window for move/end to catch fingers sliding off control
        window.addEventListener('touchmove',(e)=>{
            if(!isTouching||isGameOver||isPaused||isLevelUp)return;
            let found=false;
            for(let i=0;i<e.changedTouches.length;i++){const touch=e.changedTouches[i];
                if(touch.identifier===touchIdentifier){
                    e.preventDefault(); // Prevent scrolling only if handling our touch
                    touchCurrentX=touch.clientX; touchCurrentY=touch.clientY; found=true;
                    // Update visual stick position
                    const rect=touchControls.getBoundingClientRect(); const maxDist=rect.width/2-touchStick.offsetWidth/2;
                    let dx=touchCurrentX-touchStartX; let dy=touchCurrentY-touchStartY; const dist=Math.sqrt(dx*dx+dy*dy);
                    const clampDist=Math.min(dist,maxDist); const angle=Math.atan2(dy,dx);
                    const sX=(rect.width/2)+Math.cos(angle)*clampDist-(touchStick.offsetWidth/2); const sY=(rect.height/2)+Math.sin(angle)*clampDist-(touchStick.offsetHeight/2);
                    touchStick.style.left=`${sX}px`; touchStick.style.top=`${sY}px`;
                    break; // Found our touch, stop iterating
                }
            }
        },{passive:false});

        window.addEventListener('touchend',touchEndOrCancel,{passive:false});
        window.addEventListener('touchcancel',touchEndOrCancel,{passive:false});
    } else { console.warn("Touch control elements not found. Touch input disabled."); }

    // Button Listeners (Check for existence before adding)
    if(startButton){ startButton.addEventListener('click', initGame); } else { console.error("Start Button MISSING!"); }
    if(restartButton){ restartButton.addEventListener('click', initGame); } else { console.error("Restart Button MISSING!"); }
    if(resumeButton){ resumeButton.addEventListener('click', resumeGame); } else { console.error("Resume Button MISSING!"); }
    if(quitButton){ quitButton.addEventListener('click', quitGame); } else { console.error("Quit Button MISSING!"); }
    if(pauseButton){ pauseButton.addEventListener('click', ()=>togglePause(true)); } else { console.warn("Mobile Pause Button MISSING (expected on desktop)."); }

    // Window Resize Listener (Debounced)
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            // Check if game is running and elements exist
            if (!isGameOver && gameContainer && gameContainer.style.display !== 'none') {
                const wasPaused = isPaused; // Remember state
                if (!wasPaused) pauseGame(false); // Soft pause if not already paused

                resizeGameScreen(); // Adjust layout

                // Ensure player stays within new bounds if they exist
                 if (player && player.x !== undefined) {
                     player.x=clamp(player.x,0,screenWidthChars-1); player.y=clamp(player.y,0,screenHeightChars-1);
                 }

                if (!wasPaused) resumeGame(); // Resume only if we paused it
            } else {
                 resizeGameScreen(); // Resize silently if game not active
            }
        }, 250); // Debounce time
    });

    console.log("Input listeners setup complete.");
}

// --- Initial Execution ---
// This block runs once after the script is loaded and parsed, thanks to 'defer'
console.log("Setting up ASCII Survivor v2.1...");
assignDOMElements(); // Assign elements to variables
setupInputListeners(); // Setup all event listeners
if(splashHighScores) loadAndDisplayHighScores(splashHighScores); // Load/show high scores
resizeGameScreen(); // Perform initial screen sizing
if(splashScreen) {
    splashScreen.style.display = 'flex'; // Show splash screen
} else {
    console.error("CRITICAL: Splash Screen element not found! Cannot display initial screen.");
    // Provide feedback to user if splash is missing
    document.body.innerHTML = `<p style="color: red; font-family: monospace; padding: 20px;">Error: Game cannot start because the splash screen HTML element is missing.</p>`;
}
console.log("Setup finished. Waiting for user interaction (Start Game button).");