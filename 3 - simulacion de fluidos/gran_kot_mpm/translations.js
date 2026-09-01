// Translation system for Liquid Layers
let translations = {
  en: {
    // Meta tags
    title: "Liquid Layers",
    description: "Colorful & interactive liquid simulator in the browser",

    // Accessibility labels
    carbonAdsLabel: "Carbon Ads",
    closeCarbonAds: "Close Carbon Ads",

    // Main interface
    drag: "Drag",
    javascriptRequired: "This page requires JavaScript to run.",

    // Info overlay
    keyboardShortcuts: "Keyboard Shortcuts",
    keyboardShortcutsSubtext: "(try combining keys!)",
    emit: "Emit",
    attract: "Attract",
    repel: "Repel",
    spinRight: "Spin Right",
    spinLeft: "Spin Left",
    delete: "Delete",
    lock: "Lock",
    unlock: "Unlock",
    collideCircle: "Collide Circle",
    collideLine: "Collide Line",
    collideRectangle: "Collide Rectangle",
    collideGrid: "Collide Grid",
    sculptMode: "Sculpt Mode",
    toggleSettingsUI: "Toggle Settings UI",
    fullscreen: "Fullscreen",
    mouseScrollWheel: "Mouse Scroll Wheel: Change Brush Size",
    windowCanBeMoved: "Window Can Be Moved and Resized ;)",
    about: "About",
    aboutText: "This is a WebAssembly & WebGL implementation of the paper",
    paperTitle: "Particle-based Viscoelastic Fluid Simulation",
    paperAuthors: "(Simon Clavet, Philippe Beaudoin, and Pierre Poulin)",

    // GUI Settings
    settings: "Settings",
    info: "Info",
    interaction: "Interaction",
    pointerAction: "Pointer Action",
    brushSize: "Brush Size",
    forceFieldStrength: "Force Field Strength",
    emitMaterial: "Emit Material",
    enableAccelerometer: "Enable Accelerometer",
    invertAccelerometer: "Invert Accelerometer",
    useGyro: "Use Gyro",

    // Simulation settings
    simulation: "Simulation",
    sameRestDensity: "Attract: Same",
    diffRestDensity: "Attract: Different",
    stiffness: "Stiffness",
    stiffnessNear: "Stiffness Near",
    gravX: "Gravity X",
    gravY: "Gravity Y",
    nbody: "N-Body",
    nbodyStrength: "N-Body Strength",
    stepsPerFrame: "Steps Per Frame",
    sculptVelKeep: "Sculpt Velocity Keep",

    // Materials
    materials: "Materials",
    color0: "Color 0",
    color1: "Color 1",
    color2: "Color 2",
    color3: "Color 3",
    pMass0: "Mass 0",
    pMass1: "Mass 1",
    pMass2: "Mass 2",
    pMass3: "Mass 3",
    background: "Background",

    // More menu
    more: "More",
    moreDemos: "More Demos",
    removeUI: "Remove UI",

    // Actions for pointer
    actions: {
      drag: "drag",
      attract: "attract",
      repel: "repel",
      vortex: "vortex",
      collide: "collide",
      emit: "emit",
      emit_cycle: "emit_cycle",
      lock: "lock",
      unlock: "unlock",
      delete: "delete"
    },

    // Language selection
    language: "Language",

    // Mode selection
    off: "Off",
    hello: "Hello",
    clock: "Clock",
    story: "Story",

    // Hello World
    helloWorld: "Hello World!",
  }
};

// Internationalization system
class I18n {
  constructor() {
    this.translations = translations;
    this.loadedLanguages = new Set(['en']); // English is always loaded
    // Generate supported languages from actual translation files
    this.supportedLanguages = [
      'en', 'ar', 'bn', 'cs', 'cy', 'de', 'el', 'es', 'fa', 'fi',
      'fr', 'ga', 'ha', 'haw', 'he', 'hi', 'hu', 'id', 'it', 'ja',
      'ko', 'mr', 'ms', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru',
      'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'zh',
      'zh-hant', 'zh-sg'
    ];
    // RTL (Right-to-Left) languages
    this.rtlLanguages = new Set(['ar', 'he', 'fa', 'ur']);
    this.currentLanguage = 'en';
    this.initialDetectAndSetLanguage();
  }

  // Get all supported languages with their display names
  getAllLanguageOptions() {
    return {
      'en': 'en - English',
      'ar': 'ar - العربية',
      'bn': 'bn - বাংলা',
      'cs': 'cs - Čeština',
      'cy': 'cy - Cymraeg',
      'de': 'de - Deutsch',
      'el': 'el - Ελληνικά',
      'es': 'es - Español',
      'fa': 'fa - فارسی',
      'fi': 'fi - Suomi',
      'fr': 'fr - Français',
      'ga': 'ga - Gaeilge',
      'ha': 'ha - Hausa',
      'haw': 'haw - ʻŌlelo Hawaiʻi',
      'he': 'he - עברית',
      'hi': 'hi - हिन्दी',
      'hu': 'hu - Magyar',
      'id': 'id - Bahasa Indonesia',
      'it': 'it - Italiano',
      'ja': 'ja - 日本語',
      'ko': 'ko - 한국어',
      'mr': 'mr - मराठी',
      'ms': 'ms - Bahasa Melayu',
      'nl': 'nl - Nederlands',
      'no': 'no - Norsk',
      'pa': 'pa - ਪੰਜਾਬੀ',
      'pl': 'pl - Polski',
      'pt': 'pt - Português',
      'ro': 'ro - Română',
      'ru': 'ru - Русский',
      'sv': 'sv - Svenska',
      'sw': 'sw - Kiswahili',
      'ta': 'ta - தமிழ்',
      'te': 'te - తెలుగు',
      'th': 'th - ไทย',
      'tr': 'tr - Türkçe',
      'uk': 'uk - Українська',
      'ur': 'ur - اردو',
      'vi': 'vi - Tiếng Việt',
      'zh': 'zh - 中文',
      'zh-hant': 'zh-hant - 繁體中文',
      'zh-sg': 'zh-sg - 中文 (新加坡)'
    };
  }

  // Get browser's preferred languages
  getBrowserLanguages() {
    const browserLangs = navigator.languages || [navigator.language || navigator.userLanguage || 'en'];
    return browserLangs.map(lang => lang.split('-')[0]).filter(code => this.supportedLanguages.includes(code));
  }

  // Get ordered language options for GUI (English first, then browser preferences, then rest alphabetically)
  getOrderedLanguageOptions() {
    const allLanguages = this.getAllLanguageOptions();
    const browserLangCodes = this.getBrowserLanguages();

    // Create ordered list: English first, then browser languages, then rest alphabetically
    const orderedLangs = ['en'];
    browserLangCodes.forEach(code => {
      if (code !== 'en' && !orderedLangs.includes(code)) {
        orderedLangs.push(code);
      }
    });
    Object.keys(allLanguages).forEach(code => {
      if (!orderedLangs.includes(code)) {
        orderedLangs.push(code);
      }
    });

    // Build the options object in the correct order
    const languageOptions = {};
    orderedLangs.forEach(code => {
      languageOptions[allLanguages[code]] = code;
    });

    return languageOptions;
  }

  // on page load, detect and set language from localStorage, then send i18n-rebuild event
  async initialDetectAndSetLanguage() {
    const stored = localStorage.getItem('ll-language');
    if (stored) {
      if (stored !== 'en' && this.supportedLanguages.includes(stored)) {
        await this.loadLanguage(stored);
        this.currentLanguage = stored;
        window.dispatchEvent(new CustomEvent('i18n-rebuild'));
      }
    } else {
      // Detect browser language preferences
      const detectedLang = this.detectBrowserLanguage();
      if (detectedLang && detectedLang !== 'en') {
        await this.loadLanguage(detectedLang);
        this.currentLanguage = detectedLang;
        window.dispatchEvent(new CustomEvent('i18n-rebuild'));
      }
      // If detectedLang is 'en' or null, do nothing (stay with English default)
    }

    // Update HTML lang attribute and RTL class
    document.documentElement.lang = this.currentLanguage;
    if (this.isRTL()) {
      document.documentElement.classList.add('rtl');
    } else {
      document.documentElement.classList.remove('rtl');
    }
  }

  detectBrowserLanguage() {
    // Get browser language preferences in order of preference
    const browserLanguages = navigator.languages || [navigator.language || navigator.userLanguage];

    // Check if English is explicitly preferred
    for (const lang of browserLanguages) {
      const langCode = lang.split('-')[0].toLowerCase();
      if (langCode === 'en') {
        return 'en'; // User prefers English, use it
      }
    }

    // English not found in preferences, find the highest preference supported language
    for (const lang of browserLanguages) {
      const langCode = lang.split('-')[0].toLowerCase();
      if (this.supportedLanguages.includes(langCode)) {
        return langCode;
      }
    }

    // No supported languages found in user preferences, return null (stay with English)
    return null;
  }

  async detectLanguage() {
    // Check localStorage first
    const stored = localStorage.getItem('ll-language');
    if (stored && this.supportedLanguages.includes(stored)) {
      if (!this.loadedLanguages.has(stored)) {
        await this.loadLanguage(stored);
      }
      return stored;
    }

    // Check browser language
    const browserLang = navigator.language.split('-')[0];
    if (translations[browserLang]) {
      return browserLang;
    }

    // Default to English
    return 'en';
  }

  async setLanguage(lang) {
    if (this.supportedLanguages.includes(lang)) {
      // Load language if not already loaded
      if (!this.loadedLanguages.has(lang) && lang !== 'en') {
        await this.loadLanguage(lang);
      }

      this.currentLanguage = lang;
      localStorage.setItem('ll-language', lang);
      this.updateAll();
    }
  }

  async loadLanguage(lang) {
    if (this.loadedLanguages.has(lang) || lang === 'en') {
      return; // Already loaded or English (built-in)
    }

    try {
      const response = await fetch(`translations/${lang}.json`);
      if (response.ok) {
        const langData = await response.json();
        this.translations[lang] = langData;
        this.loadedLanguages.add(lang);
      } else {
        console.warn(`Failed to load language ${lang}, falling back to English`);
      }
    } catch (error) {
      console.warn(`Error loading language ${lang}:`, error);
    }
  }

  t(key) {
    const keys = key.split('.');
    let value = this.translations[this.currentLanguage];

    for (const k of keys) {
      if (value && typeof value === 'object' && value[k] !== undefined) {
        value = value[k];
      } else {
        // Fallback to English if key not found
        value = this.translations['en'];
        for (const k of keys) {
          if (value && typeof value === 'object' && value[k] !== undefined) {
            value = value[k];
          } else {
            return key; // Return key if not found in English either
          }
        }
        break;
      }
    }

    return value;
  }

  updateElement(element, key, attribute = 'textContent') {
    if (element) {
      element[attribute] = this.t(key);
    }
  }

  updateAll() {
    // Update meta tags
    document.title = this.t('title');
    document.querySelector('meta[name="description"]').content = this.t('description');
    document.querySelector('meta[property="og:title"]').content = this.t('title');
    document.querySelector('meta[property="og:description"]').content = this.t('description');
    document.querySelector('meta[name="twitter:title"]').content = this.t('title');
    document.querySelector('meta[name="twitter:description"]').content = this.t('description');

    // Update HTML lang attribute and RTL class
    document.documentElement.lang = this.currentLanguage;
    if (this.isRTL()) {
      document.documentElement.classList.add('rtl');
    } else {
      document.documentElement.classList.remove('rtl');
    }

    // Update static text elements
    this.updateElement(document.querySelector('#carbon-wrapper .drag-carbon'), 'drag');
    this.updateElement(document.querySelector('noscript p'), 'javascriptRequired');

    // Update info overlay
    this.updateInfoOverlay();

    // Update GUI if it exists
    if (window.gui) {
      this.updateGUI();
    }

    // Update aria labels
    this.updateElement(document.querySelector('#carbon-wrapper'), 'carbonAdsLabel', 'ariaLabel');
    this.updateElement(document.querySelector('.close-carbon'), 'closeCarbonAds', 'ariaLabel');
  }

  updateInfoOverlay() {
    const info = document.getElementById('info');
    if (!info) return;

    info.innerHTML = `
      <p><b>${this.t('keyboardShortcuts')}</b> ${this.t('keyboardShortcutsSubtext')}</p>
      <p>1-4: ${this.t('emit')}</p>
      <p>A: ${this.t('attract')}</p>
      <p>R: ${this.t('repel')}</p>
      <p>X: ${this.t('spinRight')}</p>
      <p>Z: ${this.t('spinLeft')}</p>
      <p>D: ${this.t('delete')}</p>
      <p>Q/W: ${this.t('lock')}/${this.t('unlock')}</p>
      <p>C: ${this.t('collideCircle')}</p>
      <p>V: ${this.t('collideLine')}</p>
      <p>B: ${this.t('collideRectangle')}</p>
      <p>G: ${this.t('collideGrid')}</p>
      <p>S: ${this.t('sculptMode')}</p>
      <p>U: ${this.t('toggleSettingsUI')}</p>
      <p>F11: ${this.t('fullscreen')}</p>
      <p>${this.t('mouseScrollWheel')}</p>
      <p>${this.t('windowCanBeMoved')}</p>
      <br>
      <p><b>${this.t('about')}</b></p>
      <p>${this.t('aboutText')} <b>${this.t('paperTitle')}</b> ${this.t('paperAuthors')}</p>
    `;
  }

  updateGUI() {
    // This will be called when GUI is rebuilt
    // The GUI will be updated when it's recreated with new labels
  }

  getActionOptions() {
    return [
      { value: 'drag', text: this.t('actions.drag') },
      { value: 'attract', text: this.t('actions.attract') },
      { value: 'repel', text: this.t('actions.repel') },
      { value: 'vortex', text: this.t('actions.vortex') },
      { value: 'collide', text: this.t('actions.collide') },
      { value: 'emit', text: this.t('actions.emit') },
      { value: 'emit_cycle', text: this.t('actions.emit_cycle') },
      { value: 'lock', text: this.t('actions.lock') },
      { value: 'unlock', text: this.t('actions.unlock') },
      { value: 'delete', text: this.t('actions.delete') }
    ];
  }

  // Check if current language is RTL
  isRTL(lang = this.currentLanguage) {
    return this.rtlLanguages.has(lang);
  }
}

// Global i18n instance
window.i18n = new I18n();

export { I18n, translations };
export default window.i18n; 
