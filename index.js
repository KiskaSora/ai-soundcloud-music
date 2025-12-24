// AI SoundCloud Music Extension для SillyTavern
// Оптимизированная версия с быстрой загрузкой и fade

import { saveSettingsDebounced } from '../../../script.js';
import { extension_settings, getContext } from '../../extensions.js';
import { eventSource, event_types } from '../../../script.js';

const extensionName = 'ai-soundcloud';

let settings = {
    enabled: true,
    auto_analyze: true,
    mood_mapping: {
        'battle': '',
        'epic': '',
        'romantic': '',
        'dark': '',
        'calm': '',
        'energetic': '',
        'sad': '',
        'mysterious': '',
        'cozy': '',
        'tense': '',
        'hopeful': '',
        'melancholic': ''
    },
    volume: 50,
};

let widget = null;
let isScriptLoaded = false;
let isPlayerReady = false;
let currentMood = null;
let isPlaying = false;
let currentVolume = 50;
let fadeInterval = null;
let cachedSounds = {};
let lastPlayedTrackId = null;

function loadSettings() {
    if (extension_settings[extensionName]) {
        Object.assign(settings, extension_settings[extensionName]);
    }
    extension_settings[extensionName] = settings;
    currentVolume = settings.volume;
}

function saveSettings() {
    extension_settings[extensionName] = settings;
    saveSettingsDebounced();
}

function loadSoundCloudAPI() {
    return new Promise((resolve, reject) => {
        if (isScriptLoaded && window.SC) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://w.soundcloud.com/player/api.js';
        script.onload = () => {
            isScriptLoaded = true;
            console.log('[AI SoundCloud] ✓ API загружен');
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Быстрый fade для смены треков
function quickFade(from, to, duration, callback) {
    if (fadeInterval) clearInterval(fadeInterval);

    const steps = 20;
    const stepDuration = duration / steps;
    const volumeStep = (to - from) / steps;
    let currentStep = 0;
    let vol = from;

    fadeInterval = setInterval(() => {
        currentStep++;
        vol += volumeStep;

        if (currentStep >= steps) {
            clearInterval(fadeInterval);
            vol = to;
            if (widget && isPlayerReady) widget.setVolume(to);
            if (callback) callback();
        } else {
            if (widget && isPlayerReady) widget.setVolume(Math.round(vol));
        }
    }, stepDuration);
}

// Добавляем стили
function injectStyles() {
    const styleId = 'ai-soundcloud-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        #soundcloud-player-widget {
            background: var(--SmartThemeBlurTintColor, rgba(30, 30, 40, 0.5));
            border-radius: 12px;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            padding: 12px;
            margin: 15px 0;
            color: var(--SmartThemeBodyColor, #fff);
            font-family: var(--mainFontFamily, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
        }

        .sc-player-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
        }

        .sc-player-artwork {
            width: 50px;
            height: 50px;
            border-radius: 8px;
            object-fit: cover;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: sc-pulse 2s ease-in-out infinite;
        }

        @keyframes sc-pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }

        .sc-player-no-art {
            width: 50px;
            height: 50px;
            border-radius: 8px;
            background: linear-gradient(135deg, var(--ac-style-color-main, #667eea) 0%, var(--ac-style-color-shadow, #764ba2) 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .sc-player-loading {
            animation: sc-spin 1s linear infinite;
        }

        @keyframes sc-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .sc-player-info {
            flex: 1;
            min-width: 0;
        }

        .sc-player-mood {
            display: inline-block;
            background: linear-gradient(135deg, var(--ac-style-color-main, #667eea) 0%, var(--ac-style-color-shadow, #764ba2) 100%);
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
            color: #fff;
        }

        .sc-player-title {
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 3px;
            color: var(--SmartThemeBodyColor, #fff);
        }

        .sc-player-artist {
            font-size: 11px;
            opacity: 0.7;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--SmartThemeBodyColor, #fff);
        }

        .sc-player-progress {
            height: 3px;
            background: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            border-radius: 2px;
            overflow: hidden;
            margin: 10px 0;
        }

        .sc-player-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--ac-style-color-main, #667eea) 0%, var(--ac-style-color-shadow, #764ba2) 100%);
            transition: width 0.3s ease;
            border-radius: 2px;
        }

        .sc-player-controls {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .sc-player-btn {
            background: var(--ac-style-color-main, rgba(102, 126, 234, 0.15));
            border: 1px solid var(--ac-style-color-main, rgba(102, 126, 234, 0.4));
            color: var(--SmartThemeBodyColor, #fff);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .sc-player-btn:hover {
            background: var(--ac-style-color-main, rgba(102, 126, 234, 0.3));
            border-color: var(--ac-style-color-shadow, rgba(118, 75, 162, 0.6));
            transform: scale(1.1);
            box-shadow: 0 4px 12px var(--ac-style-color-shadow, rgba(102, 126, 234, 0.4));
        }

        .sc-player-btn:active {
            transform: scale(0.95);
        }

        .sc-player-btn-play {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, var(--ac-style-color-main, #667eea) 0%, var(--ac-style-color-shadow, #764ba2) 100%);
            font-size: 18px;
            color: #fff;
            border: none;
        }

        .sc-player-btn-play:hover {
            box-shadow: 0 4px 16px var(--ac-style-color-shadow, rgba(102, 126, 234, 0.6));
        }

        .sc-player-volume {
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
        }

        .sc-player-volume-label {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
            font-size: 11px;
            opacity: 0.8;
        }

        .sc-player-volume-slider {
            width: 100%;
            height: 4px;
            -webkit-appearance: none;
            appearance: none;
            background: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            border-radius: 2px;
            outline: none;
        }

        .sc-player-volume-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--ac-style-color-main, #667eea) 0%, var(--ac-style-color-shadow, #764ba2) 100%);
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .sc-player-volume-slider::-moz-range-thumb {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--ac-style-color-main, #667eea) 0%, var(--ac-style-color-shadow, #764ba2) 100%);
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .sc-player-status {
            text-align: center;
            font-size: 10px;
            opacity: 0.6;
            margin-top: 6px;
            color: var(--SmartThemeBodyColor, #fff);
        }

        .sc-mood-buttons {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-top: 15px;
        }

        .sc-mood-btn {
            padding: 8px;
            background: var(--ac-style-color-main, rgba(102, 126, 234, 0.15));
            border: 1px solid var(--ac-style-color-main, rgba(102, 126, 234, 0.4));
            border-radius: 8px;
            color: var(--SmartThemeBodyColor, #fff);
            cursor: pointer;
            font-size: 12px;
            transition: all 0.3s ease;
            text-transform: capitalize;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        }

        .sc-mood-btn:hover {
            background: var(--ac-style-color-main, rgba(102, 126, 234, 0.4));
            border-color: var(--ac-style-color-shadow, rgba(118, 75, 162, 0.6));
            transform: translateY(-2px);
            box-shadow: 0 4px 12px var(--ac-style-color-shadow, rgba(102, 126, 234, 0.4));
        }

        .sc-mood-btn:active {
            transform: scale(0.95);
        }
    `;

    document.head.appendChild(style);
}

// Анализ по ключевым словам
function analyzeMoodFromText(text) {
    const lowerText = text.toLowerCase();

    const moodKeywords = {
        battle: ['бой', 'битва', 'сражение', 'драка', 'атак', 'удар', 'меч', 'оружие', 'враг', 'fight', 'battle', 'attack', 'sword', 'combat', 'war'],
        romantic: ['люб', 'поцелу', 'объяти', 'нежн', 'сердц', 'страст', 'любимый', 'любимая', 'love', 'kiss', 'embrace', 'heart', 'passion', 'romance', 'tender', 'darling'],
        dark: ['тьма', 'темн', 'мрак', 'зло', 'страх', 'ужас', 'кошмар', 'демон', 'dark', 'shadow', 'evil', 'fear', 'horror', 'nightmare'],
        sad: ['груст', 'печал', 'слез', 'тоск', 'одиноч', 'плач', 'sad', 'tear', 'crying', 'lonely', 'sorrow', 'grief'],
        energetic: ['энерг', 'быстр', 'бег', 'прыг', 'весел', 'радост', 'energy', 'fast', 'run', 'jump', 'excitement', 'fun'],
        tense: ['напряж', 'волнени', 'тревог', 'опасн', 'угроз', 'риск', 'tension', 'anxiety', 'danger', 'threat', 'nervous'],
        mysterious: ['тайн', 'загадк', 'странн', 'мистик', 'скрыт', 'mystery', 'secret', 'strange', 'mystic', 'hidden'],
        cozy: ['уют', 'тепл', 'спокой', 'комфорт', 'домашн', 'cozy', 'warm', 'comfort', 'peaceful', 'relaxed'],
        epic: ['эпич', 'величеств', 'мощ', 'грандиозн', 'героич', 'epic', 'grand', 'mighty', 'heroic', 'legendary'],
        hopeful: ['надежд', 'светл', 'радост', 'вдохнов', 'мечт', 'hope', 'bright', 'joy', 'dream', 'optimistic'],
        melancholic: ['меланхол', 'задумч', 'размышл', 'ностальг', 'воспомин', 'melanchol', 'pensive', 'nostalg', 'memory', 'wistful'],
        calm: ['спокой', 'тих', 'мир', 'покой', 'безмятеж', 'calm', 'quiet', 'peace', 'tranquil', 'serene']
    };

    let scores = {};
    for (const [mood, keywords] of Object.entries(moodKeywords)) {
        scores[mood] = 0;
        for (const keyword of keywords) {
            if (lowerText.includes(keyword)) {
                scores[mood]++;
            }
        }
    }

    let bestMood = 'calm';
    let maxScore = 0;
    for (const [mood, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            bestMood = mood;
        }
    }

    console.log(`[AI SoundCloud] ✓ Анализ: ${bestMood} (score: ${maxScore})`);
    return bestMood;
}

async function analyzeMoodFromContext() {
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) return 'calm';

    const recentMessages = chat.slice(-3);
    const chatText = recentMessages
        .map(m => m.mes)
        .join(' ');

    return analyzeMoodFromText(chatText);
}

async function playMusicForMood(mood) {
    const playlistUrl = settings.mood_mapping[mood];

    if (!playlistUrl) {
        console.warn(`[AI SoundCloud] ❌ Нет плейлиста для: ${mood}`);
        toastr.warning(`Добавь плейлист для "${mood}"`, '', { timeOut: 2500 });
        return;
    }

    if (!isPlayerReady) await initPlayer();

    // Если настроение изменилось - делаем быстрый fade
    const moodChanged = currentMood && currentMood !== mood;

    if (moodChanged && isPlaying) {
        console.log(`[AI SoundCloud] 🎭 Смена: ${currentMood} → ${mood}`);
        // Быстрый fade out (1 секунда)
        quickFade(currentVolume, 0, 1000, () => {
            currentMood = mood;
            loadPlaylist(playlistUrl, mood, true);
        });
    } else {
        currentMood = mood;
        await loadPlaylist(playlistUrl, mood, false);
    }
}

async function loadPlaylist(playlistUrl, mood, useFadeIn = false) {
    console.log(`[AI SoundCloud] 🎵 Загружаю: ${mood}`);
    showLoadingState(mood);

    const iframe = document.getElementById('soundcloud-player-iframe');
    const randomSeed = Math.floor(Math.random() * 999999);

    // БЫСТРАЯ загрузка с auto_play
    const widgetUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(playlistUrl)}` +
        `&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true&t=${randomSeed}`;

    iframe.src = widgetUrl;
    widget = window.SC.Widget(iframe);

    // Сбрасываем кэш для этого настроения при новой загрузке
    delete cachedSounds[mood];

    let readyFired = false;
    widget.bind(window.SC.Widget.Events.READY, function () {
        if (readyFired) return;
        readyFired = true;

        console.log('[AI SoundCloud] ✓ Widget READY');

        // Если нужен fade in - начинаем с 0
        if (useFadeIn) {
            widget.setVolume(0);
        } else {
            widget.setVolume(settings.volume);
        }

        loadTrackInfo(mood, useFadeIn);
    });

    function loadTrackInfo(mood, useFadeIn) {
        widget.getSounds(function(sounds) {
            if (!sounds || sounds.length === 0) {
                console.warn('[AI SoundCloud] ❌ Плейлист пуст');
                return;
            }

            // Кэшируем треки
            cachedSounds[mood] = sounds;
            console.log(`[AI SoundCloud] ✓ Загружено ${sounds.length} треков`);

            // Получаем текущую позицию
            widget.getCurrentSoundIndex(function(currentIndex) {
                const currentSound = sounds[currentIndex] || sounds[0];
                lastPlayedTrackId = currentSound.id;

                updateNowPlaying(currentSound, mood);

                // Fade in если нужно
                if (useFadeIn) {
                    setTimeout(() => {
                        quickFade(0, settings.volume, 1000);
                    }, 100);
                }
            });
        });
    }

    widget.bind(window.SC.Widget.Events.PLAY, function () {
        isPlaying = true;
        updatePlayPauseButton();
    });

    widget.bind(window.SC.Widget.Events.PAUSE, function () {
        isPlaying = false;
        updatePlayPauseButton();
    });

    widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, function (data) {
        updateProgress(data.relativePosition);
    });

    widget.bind(window.SC.Widget.Events.FINISH, function () {
        console.log('[AI SoundCloud] ⏭ Автоследующий');
        // Плеер сам переключит на следующий с fade
        widget.next();
    });
}

function playNextTrack(mood) {
    const sounds = cachedSounds[mood];

    if (!sounds || sounds.length === 0) {
        widget.next();
        return;
    }

    // Выбираем ДРУГОЙ трек (не тот же самый)
    let attempts = 0;
    let randomIndex;

    do {
        randomIndex = Math.floor(Math.random() * sounds.length);
        attempts++;
    } while (sounds[randomIndex].id === lastPlayedTrackId && attempts < 10 && sounds.length > 1);

    const nextSound = sounds[randomIndex];
    lastPlayedTrackId = nextSound.id;

    console.log(`[AI SoundCloud] ⏭ Трек ${randomIndex + 1}/${sounds.length}`);

    // Быстрый fade для смены
    quickFade(currentVolume, 0, 800, () => {
        updateNowPlaying(nextSound, mood);
        widget.skip(randomIndex);
        widget.play();

        setTimeout(() => {
            quickFade(0, settings.volume, 800);
        }, 100);
    });
}

function showLoadingState(mood) {
    const widgetDiv = document.getElementById('soundcloud-player-widget');
    if (!widgetDiv) return;

    widgetDiv.innerHTML = `
        <div class="sc-player-header">
            <div class="sc-player-no-art sc-player-loading">🎵</div>
            <div class="sc-player-info">
                <div class="sc-player-mood">${mood}</div>
                <div class="sc-player-title">Загрузка...</div>
                <div class="sc-player-artist">Ждите...</div>
            </div>
        </div>
        <div class="sc-player-progress">
            <div class="sc-player-progress-fill" style="width: 0%"></div>
        </div>
        <div class="sc-player-status">⏳ Загрузка</div>
    `;
    widgetDiv.style.display = 'block';
}

function updateNowPlaying(sound, mood) {
    const widgetDiv = document.getElementById('soundcloud-player-widget');
    if (!widgetDiv) return;

    const artworkUrl = sound.artwork_url || sound.user.avatar_url;
    const displayArt = artworkUrl ? artworkUrl.replace('-large', '-t300x300') : null;

    widgetDiv.innerHTML = `
        <div class="sc-player-header">
            ${displayArt 
                ? `<img src="${displayArt}" alt="cover" class="sc-player-artwork">` 
                : '<div class="sc-player-no-art">🎵</div>'
            }
            <div class="sc-player-info">
                <div class="sc-player-mood">${mood}</div>
                <div class="sc-player-title" title="${sound.title}">${sound.title}</div>
                <div class="sc-player-artist" title="${sound.user.username}">${sound.user.username}</div>
            </div>
        </div>
        <div class="sc-player-progress">
            <div class="sc-player-progress-fill" id="sc-progress-fill" style="width: 0%"></div>
        </div>
        <div class="sc-player-controls">
            <button class="sc-player-btn" id="sc-shuffle-btn" title="Случайный">🔀</button>
            <button class="sc-player-btn sc-player-btn-play" id="sc-play-btn" title="Пауза">⏸</button>
            <button class="sc-player-btn" id="sc-next-btn" title="Следующий">⏭</button>
        </div>
        <div class="sc-player-volume">
            <div class="sc-player-volume-label">
                <span>🔊 Громкость</span>
                <span id="sc-volume-value">${settings.volume}%</span>
            </div>
            <input type="range" class="sc-player-volume-slider" id="sc-volume-slider" min="0" max="100" value="${settings.volume}">
        </div>
        <div class="sc-player-status" id="sc-status">▶ Играет</div>
    `;

    widgetDiv.style.display = 'block';

    // Обработчики кнопок
    document.getElementById('sc-shuffle-btn').onclick = () => playNextTrack(mood);

    document.getElementById('sc-play-btn').onclick = () => {
        if (widget) {
            widget.isPaused(function(paused) {
                if (paused) {
                    widget.play();
                } else {
                    widget.pause();
                }
            });
        }
    };

    document.getElementById('sc-next-btn').onclick = () => playNextTrack(mood);

    // Обработчик слайдера громкости
    document.getElementById('sc-volume-slider').oninput = function() {
        const volume = parseInt(this.value);
        settings.volume = volume;
        currentVolume = volume;
        document.getElementById('sc-volume-value').textContent = volume + '%';

        if (widget && isPlayerReady) {
            widget.setVolume(volume);
        }

        saveSettings();
    };

    updatePlayPauseButton();
}

function updatePlayPauseButton() {
    const btn = document.getElementById('sc-play-btn');
    const status = document.getElementById('sc-status');

    if (btn && status) {
        if (isPlaying) {
            btn.innerHTML = '⏸';
            btn.title = 'Пауза';
            status.innerHTML = '▶ Играет';
        } else {
            btn.innerHTML = '▶';
            btn.title = 'Воспроизвести';
            status.innerHTML = '⏸ Пауза';
        }
    }
}

function updateProgress(progress) {
    const fill = document.getElementById('sc-progress-fill');
    if (fill) {
        fill.style.width = (progress * 100) + '%';
    }
}

function onMessageReceived(data) {
    if (!settings.enabled || !settings.auto_analyze) return;
    if (data.is_user) return;

    console.log('[AI SoundCloud] 🔍 Анализирую...');
    setTimeout(async () => {
        const mood = await analyzeMoodFromContext();
        await playMusicForMood(mood);
    }, 1500);
}

function initUI() {
    if (document.getElementById('ai-soundcloud-settings')) return;

    const availableMoods = Object.keys(settings.mood_mapping);

    const settingsHtml = `
        <div id="ai-soundcloud-settings" class="ai-soundcloud-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🎵 AI SoundCloud Music</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label">
                        <input type="checkbox" id="sc-enabled" ${settings.enabled ? 'checked' : ''}>
                        <span>Включить расширение</span>
                    </label>

                    <label class="checkbox_label">
                        <input type="checkbox" id="sc-auto" ${settings.auto_analyze ? 'checked' : ''}>
                        <span>Автоподбор музыки</span>
                    </label>

                    <hr>
                    <h4>🎭 Быстрый выбор настроения:</h4>
                    <div class="sc-mood-buttons">
                        ${availableMoods.map(mood => 
                            `<button class="sc-mood-btn" data-mood="${mood}">${mood}</button>`
                        ).join('')}
                    </div>

                    <div id="soundcloud-player-widget" style="display: none;"></div>

                    <hr>
                    <div class="sc-playlists">
                        <h4>🎵 Плейлисты для настроений:</h4>
                        ${availableMoods.map(mood => `
                            <label>
                                <span>${mood}:</span>
                                <input type="text" class="text_pole sc-playlist-input" data-mood="${mood}" value="${settings.mood_mapping[mood]}" placeholder="https://soundcloud.com/...">
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>

        <iframe id="soundcloud-player-iframe" 
                width="100%" 
                height="166" 
                scrolling="no" 
                frameborder="no" 
                allow="autoplay; encrypted-media" 
                style="position: fixed; bottom: 0; left: 0; width: 100%; z-index: -1; opacity: 0;">
        </iframe>
    `;

    const panel = document.getElementById('extensions_settings2');
    if (panel) {
        panel.insertAdjacentHTML('beforeend', settingsHtml);

        document.getElementById('sc-enabled').onchange = function() {
            settings.enabled = this.checked;
            saveSettings();
        };

        document.getElementById('sc-auto').onchange = function() {
            settings.auto_analyze = this.checked;
            saveSettings();
        };

        document.querySelectorAll('.sc-mood-btn').forEach(btn => {
            btn.onclick = async function() {
                const mood = this.dataset.mood;
                console.log(`[AI SoundCloud] 🎭 ${mood}`);
                await playMusicForMood(mood);
            };
        });

        document.querySelectorAll('.sc-playlist-input').forEach(input => {
            input.oninput = function() {
                const mood = this.dataset.mood;
                settings.mood_mapping[mood] = this.value.trim();
                saveSettings();
            };
        });

        console.log('[AI SoundCloud] ✓ UI создан');
    }
}

async function initPlayer() {
    if (isPlayerReady) return;

    await loadSoundCloudAPI();

    const iframe = document.getElementById('soundcloud-player-iframe');
    if (!iframe) {
        console.error('[AI SoundCloud] ❌ Iframe не найден');
        return;
    }

    const dummyUrl = 'https://w.soundcloud.com/player/?url=https://soundcloud.com/discover';
    iframe.src = dummyUrl;

    widget = window.SC.Widget(iframe);

    return new Promise(resolve => {
        widget.bind(window.SC.Widget.Events.READY, function () {
            widget.setVolume(settings.volume);
            isPlayerReady = true;
            console.log('[AI SoundCloud] ✓ Player готов');
            resolve();
        });
    });
}

jQuery(async () => {
    loadSettings();
    injectStyles();

    setTimeout(async () => {
        initUI();
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        await initPlayer();
        console.log('[AI SoundCloud] ✅ Запущен (оптимизировано)');
    }, 1000);
});
