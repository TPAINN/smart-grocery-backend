// services/scraper.js
require('dotenv').config();
const cron = require('node-cron');
const Product = require('../models/Product');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { Cluster } = require('puppeteer-cluster');

// --- CONSTANTS: ΣΤΑΘΕΡΕΣ URLS (Όπως τις είχαμε) ---
const SKLAVENITIS_URLS =[
    "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/psomi-artoskeyasmata/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/psomi-typopoiimeno/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/pites-tortigies/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/kritsinia-paximadia-fryganies/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/koyloyria-voytimata/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/keik-tsoyrekia-kroyasan/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/glyka/", "https://www.sklavenitis.gr/freska-froyta-lachanika/froyta/", "https://www.sklavenitis.gr/freska-froyta-lachanika/lachanika/", "https://www.sklavenitis.gr/freska-froyta-lachanika/kommena-lahanika/", "https://www.sklavenitis.gr/fresko-psari-thalassina/psaria-ichthyokalliergeias/", "https://www.sklavenitis.gr/fresko-psari-thalassina/chtapodia-kalamaria-soypies/", "https://www.sklavenitis.gr/fresko-psari-thalassina/ostrakoeidi/", "https://www.sklavenitis.gr/fresko-kreas/fresko-moschari/", "https://www.sklavenitis.gr/fresko-kreas/fresko-choirino/", "https://www.sklavenitis.gr/fresko-kreas/freska-poylerika/", "https://www.sklavenitis.gr/fresko-kreas/freska-arnia-katsikia/", "https://www.sklavenitis.gr/fresko-kreas/freska-paraskeyasmata-kreaton-poylerikon/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/galata-psygeioy/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/galata-sokolatoycha-psygeioy/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/futika-alla-rofimata-psugeiou/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/chymoi-tsai-psygeioy/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/giaoyrtia/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/giaoyrtia-vrefika-paidika/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/epidorpia-giaoyrtioy/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/fytika-epidorpia/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/ryzogala-glykismata-psygeioy/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/proteinouha-giaoyrtia-epidorpia-glykismata-psygeiou/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/kremes-galaktos-santigi/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/feta-leyka-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/malaka-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/imisklira-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/sklira-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/tyria-aleifomena-mini-tyrakia/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/futika-anapliromata/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/ayga/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/voytyra/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/margarines/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/zymes-nopes/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/freska-zymarika-saltses/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/zomoi-psygeioy/", "https://www.sklavenitis.gr/allantika/allantika-galopoylas-kotopoyloy/", "https://www.sklavenitis.gr/allantika/zampon-mpeikon-omoplati/", "https://www.sklavenitis.gr/allantika/pariza-mortadela/", "https://www.sklavenitis.gr/allantika/salamia/", "https://www.sklavenitis.gr/allantika/loykanika/", "https://www.sklavenitis.gr/allantika/paradosiaka-allantika/", "https://www.sklavenitis.gr/allantika/set-allantikon-tyrion/", "https://www.sklavenitis.gr/orektika-delicatessen/psaria-pasta-se-ladi/", "https://www.sklavenitis.gr/orektika-delicatessen/kapnista-psaria/", "https://www.sklavenitis.gr/orektika-delicatessen/delicatessen-thalassinon/", "https://www.sklavenitis.gr/orektika-delicatessen/pate-foie-gras/", "https://www.sklavenitis.gr/orektika-delicatessen/salates-aloifes/", "https://www.sklavenitis.gr/orektika-delicatessen/elies/", "https://www.sklavenitis.gr/orektika-delicatessen/toyrsia-liastes-tomates/", "https://www.sklavenitis.gr/orektika-delicatessen/chalvades/", "https://www.sklavenitis.gr/etoima-geymata/geymata-me-kreas-poylerika/", "https://www.sklavenitis.gr/etoima-geymata/geymata-me-psaria-thalassina-sushi/", "https://www.sklavenitis.gr/etoima-geymata/geymata-osprion-lachanikon/", "https://www.sklavenitis.gr/etoima-geymata/ladera/", "https://www.sklavenitis.gr/etoima-geymata/geymata-zymarikon-ryzioy/", "https://www.sklavenitis.gr/etoima-geymata/soupes/", "https://www.sklavenitis.gr/etoima-geymata/etoimes-salates-synodeytika-geymaton/", "https://www.sklavenitis.gr/etoima-geymata/santoyits/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-lachanika-froyta/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-psaria-thalassina/", "http://sklavenitis.gr/katepsygmena/katepsygmena-kreata-poylerika/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-fytika-anapliromata/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-geymata/", "https://www.sklavenitis.gr/katepsygmena/katepsygmenes-zymes-pites-pitses/", "https://www.sklavenitis.gr/katepsygmena/pagota-pagakia/", "https://www.sklavenitis.gr/kava/pota/", "https://www.sklavenitis.gr/kava/krasia-sampanies/", "https://www.sklavenitis.gr/kava/mpires-milites/", "https://www.sklavenitis.gr/anapsyktika-nera-chymoi/nera/", "https://www.sklavenitis.gr/anapsyktika-nera-chymoi/anapsyktika-sodes-energeiaka-pota/", "https://www.sklavenitis.gr/anapsyktika-nera-chymoi/chymoi/", "https://www.sklavenitis.gr/xiroi-karpoi-snak/xiroi-karpoi-apoxiramena-froyta/", "https://www.sklavenitis.gr/xiroi-karpoi-snak/patatakia-garidakia-alla-snak/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/mpiskota/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/sokolates/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/pastelia-mantolata-loykoymia/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/tsichles-karameles-gleifitzoyria/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/galata-fytika-rofimata-makras-diarkeias/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/dimitriaka-mpares/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/kafedes-rofimata-afepsimata/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/melia-marmelades/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/pralines-tachini-fystikovoytyro/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/proteines-se-skoni/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefika-paidika-galata/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefika-paidika-fagita/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefikes-paidikes-kremes/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefika-paidika-snak/", "https://www.sklavenitis.gr/trofima-pantopoleioy/aleyria-simigdalia/", "https://www.sklavenitis.gr/trofima-pantopoleioy/zachari-ypokatastata-zacharis/", "https://www.sklavenitis.gr/trofima-pantopoleioy/zymarika/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ketsap-moystardes-magionezes-etoimes-saltses/", "https://www.sklavenitis.gr/trofima-pantopoleioy/konserves-kompostes/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ladia-lipi/", "https://www.sklavenitis.gr/trofima-pantopoleioy/mpacharika-alatia-xidia-zomoi/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ryzia/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ospria/", "https://www.sklavenitis.gr/trofima-pantopoleioy/sitari-kinoa-sogia-alla-dimitriaka/", "https://www.sklavenitis.gr/trofima-pantopoleioy/poyredes-soypes-noodles/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ntomatika/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ylika-mageirikis-zacharoplastikis/", "https://www.sklavenitis.gr/trofima-pantopoleioy/meigmata-gia-zele-glyka/", "https://www.sklavenitis.gr/trofes-eidi-gia-katoikidia/trofes-eidi-gia-skyloys/", "https://www.sklavenitis.gr/trofes-eidi-gia-katoikidia/trofes-eidi-gia-gates/", "https://www.sklavenitis.gr/trofes-eidi-gia-katoikidia/trofes-eidi-gia-ptina-psaria-alla-katoikidia/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/eidi-syntirisis-psisimatos-trofimon/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/sakoyles-aporrimmaton/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/kalamakia-odontoglyfides/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/servitsia-mias-chrisis/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/eidi-parti/", "https://www.sklavenitis.gr/chartika-panes-servietes/chartika/", "https://www.sklavenitis.gr/chartika-panes-servietes/servietes-panes-enilikon/", "https://www.sklavenitis.gr/chartika-panes-servietes/vrefikes-paidikes-panes-moromantila/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/frontida-mallion/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/frontida-somatos/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/eidi-xyrismatos-after-shave/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/stomatiki-ygieini/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/ygieini-peripoiisi-prosopoy/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/makigiaz-vernikia-nychion/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/vrefika-paidika-kallyntika/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/parafarmakeytika-eidi/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/aporrypantika-roychon/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/aporrypantika-piaton/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/katharistika-genikis-chrisis/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/synerga-katharismoy/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/eidi-sideromatos-aplomatos/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/fylaxi-peripoiisi-roychon/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/peripoiisi-ypodimaton/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/aromatika-horou-sullektes-ugrasias-filtra-aporrofitira/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/entomoapothitika-entomoktona/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/kausimes-ules/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/eidi-ugraeriou-anaptires-spirta/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/eidi-thymiamatos/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/mpataries-lampes-ilektrologika-eidi-tainies/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/isothermikes-tsades-karotsia-laikis/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/ilektrikes-mikrosuskeues/", "https://www.sklavenitis.gr/chartopoleio/grafiki-yli-organosi-grafeioy/", "https://www.sklavenitis.gr/chartopoleio/tetradia-blok-fakeloi-harti-fototypiko/"
];
const MYMARKET_URLS =[
    "https://www.mymarket.gr/frouta-lachanika", "https://www.mymarket.gr/fresko-kreas-psari", "https://www.mymarket.gr/galaktokomika-eidi-psygeiou", "https://www.mymarket.gr/tyria-allantika-deli", "https://www.mymarket.gr/katepsygmena-trofima", "https://www.mymarket.gr/mpyres-anapsyktika-krasia-pota", "https://www.mymarket.gr/proino-rofimata-kafes", "https://www.mymarket.gr/artozacharoplasteio-snacks", "https://www.mymarket.gr/trofima", "https://www.mymarket.gr/frontida-gia-to-moro-sas", "https://www.mymarket.gr/prosopiki-frontida", "https://www.mymarket.gr/oikiaki-frontida-chartika", "https://www.mymarket.gr/kouzina-mikrosyskeves-spiti", "https://www.mymarket.gr/frontida-gia-to-katoikidio-sas", "https://www.mymarket.gr/epochiaka", "https://www.mymarket.gr/viral-trends", "https://www.mymarket.gr/vegan-epiloges-sta-my-market"
];
const MASOUTIS_URLS =[
    "https://www.masoutis.gr/categories/index/prosfores?item=0", "https://www.masoutis.gr/categories/index/nea-proionta?item=11", "https://www.masoutis.gr/categories/index/meiwsh-timhs?item=9", "https://www.masoutis.gr/categories/index/proionta-masouths?item=2"
];
const KRITIKOS_URLS =[
    "https://kritikos-sm.gr/offers/", "https://kritikos-sm.gr/categories/manabikh/", "https://kritikos-sm.gr/categories/fresko-kreas/", "https://kritikos-sm.gr/categories/allantika/", "https://kritikos-sm.gr/categories/turokomika/", "https://kritikos-sm.gr/categories/galaktokomika/", "https://kritikos-sm.gr/categories/eidh-psugeiou/", "https://kritikos-sm.gr/categories/katapsuxh/", "https://kritikos-sm.gr/categories/pantopwleio/", "https://kritikos-sm.gr/categories/kaba/", "https://kritikos-sm.gr/categories/proswpikh-frontida/", "https://kritikos-sm.gr/categories/brefika/", "https://kritikos-sm.gr/categories/kathariothta/", "https://kritikos-sm.gr/categories/oikiakh-xrhsh/", "https://kritikos-sm.gr/categories/pet-shop/", "https://kritikos-sm.gr/categories/biologikaleitourgika/"
];
const GALAXIAS_URLS =[
    "https://galaxias.shop/eshop/2?promos=isExtraBonus&promos=isBravoBonus&promos=isKalathiNoikokiriou&promos=isSumferei&promos=isTileoptiko&promos=isGoldPrices", "https://galaxias.shop/eshop/59", "https://galaxias.shop/eshop/69", "https://galaxias.shop/eshop/194", "https://galaxias.shop/eshop/95", "https://galaxias.shop/eshop/66", "https://galaxias.shop/eshop/104", "https://galaxias.shop/eshop/68", "https://galaxias.shop/eshop/103", "https://galaxias.shop/eshop/1080515", "https://galaxias.shop/eshop/89", "https://galaxias.shop/eshop/88", "https://galaxias.shop/eshop/788", "https://galaxias.shop/eshop/342", "https://galaxias.shop/eshop/93", "https://galaxias.shop/eshop/75", "https://galaxias.shop/eshop/64", "https://galaxias.shop/eshop/72", "https://galaxias.shop/eshop/245", "https://galaxias.shop/eshop/86"
];
const MARKET_IN_URLS =[
    "https://www.market-in.gr/el-gr/manabikh", "https://www.market-in.gr/el-gr/kreopoleio-1", "https://www.market-in.gr/el-gr/tyrokomika-allantika", "https://www.market-in.gr/el-gr/trofima", "https://www.market-in.gr/el-gr/kava", "https://www.market-in.gr/el-gr/vrefika", "https://www.market-in.gr/el-gr/galaktokomika-proionta-psugeiou", "https://www.market-in.gr/el-gr/katepsugmena", "https://www.market-in.gr/el-gr/prosopikh-frontida", "https://www.market-in.gr/el-gr/kathariothta", "https://www.market-in.gr/el-gr/ola-gia-to-spiti", "https://www.market-in.gr/el-gr/katoikidia"
];

const STORE_CONFIGS = {
    'ΑΒ Βασιλόπουλος': { card: 'article,[data-testid^="product-block"]', name: '[data-testid="product-name"],[data-testid="product-block-name-link"]', price: '.sc-dqia0p-8,[data-testid="product-block-price"]', promo: '[data-testid="tag-promo-label"]' },
    'Σκλαβενίτης': { card: '.product, li.item, .product-list > div, .product-card', name: 'h4 a, h4, .product__title a, .product__name a', price: '.price, [data-price]', oldPrice: 'del, .price.old', promo: '.offer-span, .text-minus' },
    'Κρητικός': { card: '[class*="ProductListItem_root"], div[class*="ProductListItem"]', name: '[class*="ProductListItem_title"]', price: '[class*="ProductListItem_finalPrice"]', promo: '[class*="ProductListItem_badgeOffer"]' },
    'MyMarket': { card: 'article, .product, .product-item, .product-card, .products-listing > div, div.relative.flex.flex-col', name: '.line-clamp-2', oldPrice: '.diagonal-line', promo: '.product-note-tag', nextBtn: 'a[rel="next"],[data-mkey="next"]' },
    'Μασούτης': { card: '.product-item, .col-product', name: '.productTitle', price: '.price', promo: '.pDscntPercent', loader: '.lds-spinner' },
    'Market In': { card: '.product-grid-box, .product', name: '.product-ttl', price: '.new-price', oldPrice: '.old-price', promo: '.disc-value', nextBtn: 'span.material-icons, a.next' },
    'Γαλαξίας': { card: '.product-card, .col', name: '.text-black-i, h2', price: 'span[style*="rgb(2, 88, 165)"]', promo: '.bg-secondary.text-primary' }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🟢 Η Μπάρα Προόδου στο CLI
let globalIsScraping = false; 
let totalJobs = 0;
let completedJobs = 0;

const drawProgressBar = (current, total, storeName) => {
    const width = 30;
    const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
    const filled = total === 0 ? 0 : Math.floor((width * percent) / 100);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    process.stdout.write(`\r[${bar}] ${percent}% | 🛒 ${storeName} | ✅ ${current}/${total} Σελίδες ολοκληρώθηκαν`);
};

// 🟢 O ΑΠΟΛΥΤΟΣ EXTRACTOR
const extractDataInBrowser = (storeName, config) => {
    const products =[];
    
    // 🧠 SMART PRICE PARSER
    const parsePrice = (text) => {
        if (!text) return null;
        let baseText = text.replace(/\s+/g, ' ').split('€')[0].trim();
        let cleanText = baseText.replace(/[^\d,.]/g, '');
        if (!cleanText) return null;

        if (cleanText.includes(',') || cleanText.includes('.')) {
            cleanText = cleanText.replace(',', '.');
            let finalNum = parseFloat(cleanText);
            if (finalNum > 300) return finalNum / 100;
            return finalNum;
        } 
        
        const num = parseInt(cleanText, 10);
        if (isNaN(num)) return null;

        if (num > 99 || storeName === 'ΑΒ Βασιλόπουλος') {
            return num / 100;
        }
        
        return num;
    };

    let cards = Array.from(document.querySelectorAll(config.card));
    if (cards.length === 0) {
        let anchorEls = Array.from(document.querySelectorAll(config.name));
        if (anchorEls.length === 0 && config.price) anchorEls = Array.from(document.querySelectorAll(config.price));
        anchorEls.forEach(el => {
            const wrapper = el.closest('article, li, .product,[data-testid^="product"], .relative, div[data-mkey], div.item, .product-card, .s-grid__item, .product-grid-box') || el.parentElement.parentElement.parentElement;
            if (wrapper && !cards.includes(wrapper)) cards.push(wrapper);
        });
    }
    
    cards.forEach(card => {
        let name = '', priceNum = null, oldPriceNum = null, isSale = false, is1plus1 = false, imgUrl = null;
        
        // Όνομα
        const nameEl = card.querySelector(config.name) || card.querySelector('h2, h3, h4, [class*="title"],[data-qa-label*="title"]');
        if (nameEl) name = (nameEl.textContent || nameEl.innerText || '').trim();
        if (!name && storeName === 'ΑΒ Βασιλόπουλος') {
            const abName = card.querySelector('[data-testid="product-name"]');
            if (abName) name = (abName.textContent || '').trim();
        }
        
        // ── Τιμή: τελική τιμή συσκευασίας ──────────
        const isUnitPrice = (txt) => /\/\s*(τεμ|kg|lt|κιλ|λίτρ|100g|100ml)/i.test(txt) ||
                                      /ανά\s*(κιλό|λίτρο|τεμ|kg|lt)/i.test(txt) ||
                                      / τεμ\.\s*$/.test(txt.trim());

        if (storeName === 'MyMarket') {
            // 🎯 ΑΚΡΙΒΕΙΣ SELECTORS ΜΟΝΟ ΓΙΑ ΤΗΝ ΤΕΛΙΚΗ ΤΙΜΗ ΠΩΛΗΣΗΣ
            // Αφαιρέσαμε το σκέτο .font-semibold γιατί έπιανε την τιμή τεμαχίου!
            const mainPriceEl = card.querySelector('.selling-unit-row .price, .product-full--final-price');

            if (mainPriceEl) {
                priceNum = parsePrice(mainPriceEl.innerText || mainPriceEl.textContent);
            } 
            
            // Fallback (Σε περίπτωση που αλλάξει κάτι στο DOM)
            if (!priceNum) {
                const candidates = Array.from(card.querySelectorAll('.font-semibold, .price'));
                for (const el of candidates) {
                    if (el.classList.contains('diagonal-line')) continue;

                    // ΑΓΝΟΟΥΜΕ ρητά τα wrappers που κρατάνε την τιμή μονάδας/κιλού!
                    if (el.closest('.measure-label-wrapper') || el.closest('.measurment-unit-row') || el.closest('.base-price-wrapper') || el.closest('[class*="base-price"]')) continue;

                    const txt = (el.innerText || el.textContent || '').trim();
                    if (!txt || !txt.includes('€')) continue;

                    const parsed = parsePrice(txt);
                    if (parsed && parsed > 0 && parsed < 999) { 
                        priceNum = parsed; 
                        break; 
                    }
                }
            }
        } else {
            // Υπόλοιπα supermarkets: γενική λογική
            const priceEl = card.querySelector(config.price) || card.querySelector('[class*="price"]');
            if (priceEl) {
                const rawText = (priceEl.innerText || priceEl.textContent || '');
                priceNum = parsePrice(isUnitPrice(rawText) ? rawText.split('/')[0] : rawText);
            }
        }
        
        // Παλιά Τιμή
        if (config.oldPrice) {
            const oldPriceEl = card.querySelector(config.oldPrice);
            if (oldPriceEl) oldPriceNum = parsePrice(oldPriceEl.innerText || oldPriceEl.textContent);
        }
        
        // Προσφορές
        if (config.promo) {
            const promos = card.querySelectorAll(config.promo);
            promos.forEach(p => {
                const pText = (p.textContent || p.innerText || '').toLowerCase();
                if (pText.includes('%') || pText.includes('-') || pText.includes('super')) isSale = true;
                if (pText.includes('1+1') || pText.includes('δωρο')) { is1plus1 = true; isSale = true; }
            });
        }
        
        // Εικόνα
        const imgEl = card.querySelector('img');
        if (imgEl) imgUrl = imgEl.src || imgEl.getAttribute('data-src');
        
        // Αποθήκευση ΜΟΝΟ αν η τιμή είναι έγκυρη
        if (name && priceNum && priceNum > 0) {
            name = name.replace(/(το τεμάχιο|το τεμαχιο|συσκευασία|συσκευασια)/gi, '').trim();
            const normalizedName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            products.push({ name, normalizedName, supermarket: storeName, price: priceNum, oldPrice: oldPriceNum, isOnSale: isSale, is1plus1: is1plus1, imageUrl: imgUrl });
        }
    });
    
    return products;
};

// ...[STRATEGY FUNCTIONS ΑΚΡΙΒΩΣ ΟΠΩΣ ΤΙΣ ΕΙΧΑΜΕ]
async function scrapeSklavenitis(page, storeName, config, allFound) {
    let keepGoing = true; let fails = 0;
    while (keepGoing) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }
        const status = await page.evaluate(() => {
            const counter = document.querySelector('span.current-page');
            if (counter) {
                const match = counter.innerText.match(/(\d+)\s*από\s*τα\s*(\d+)/);
                if (match && parseInt(match[1]) >= parseInt(match[2])) return 'DONE';
            }
            return 'SCROLL';
        });
        if (status === 'DONE' || fails > 15) break; 
        await page.keyboard.press('PageDown'); await sleep(400);
    }
}
async function scrapeAB(page, storeName, config, allFound) {
    let fails = 0;
    while (fails < 15) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }
        await page.keyboard.press('PageDown'); await sleep(500); 
    }
}
async function scrapeGalaxias(page, storeName, config, allFound) {
    let fails = 0;
    while (fails < 5) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }
        for (let i = 0; i < 20; i++) { await page.keyboard.press('PageDown'); await sleep(30); }
        await page.keyboard.press('PageUp'); await sleep(100); await page.keyboard.press('PageDown');
        await sleep(1000); 
    }
}
async function scrapeMyMarket(page, storeName, config, allFound) {
    let keepGoing = true; let fails = 0;
    while (keepGoing && fails < 10) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        products.forEach(p => allFound.set(p.normalizedName, p));
        const hasNext = await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn && !btn.disabled && btn.offsetParent !== null) { btn.click(); return true; }
            return false;
        }, config.nextBtn);
        if (hasNext) { await sleep(2500); fails = 0; } 
        else { fails++; keepGoing = false; }
    }
}
async function scrapeMarketIn(page, storeName, config, allFound) {
    let keepGoing = true; let fails = 0;
    while (keepGoing && fails < 10) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        products.forEach(p => allFound.set(p.normalizedName, p));
        const hasNext = await page.evaluate((sel) => {
            const btns = Array.from(document.querySelectorAll(sel));
            for (let btn of btns) {
                if (btn && !btn.disabled && btn.offsetParent !== null && (btn.innerText.includes('keyboard_arrow_right') || btn.tagName === 'A')) {
                    btn.click(); return true;
                }
            }
            return false;
        }, config.nextBtn);
        if (hasNext) { await sleep(2500); fails = 0; } 
        else { fails++; keepGoing = false; }
    }
}
async function scrapeMasoutis(page, storeName, config, allFound) {
    let fails = 0;
    while (fails < 15) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }
        await page.keyboard.press('PageDown');
        await page.evaluate((sel) => {
            const loader = document.querySelector(sel);
            if (loader && loader.style.display !== 'none') return true;
            return false;
        }, config.loader).then(isWaiting => isWaiting ? sleep(1500) : sleep(300));
    }
}
async function scrapeKritikos(page, storeName, config, allFound) {
    let fails = 0;
    while (fails < 15) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }
        for (let i = 0; i < 6; i++) { await page.keyboard.press('PageDown'); await sleep(100); }
    }
}

// 🧠 THE WORKER ΜΕ SMART RETRIES
async function scrapeTask({ page, data: { url, storeName } }) {
    const config = STORE_CONFIGS[storeName];
    const allFound = new Map();
    
    // Retry Logic
    let retries = 3;
    while (retries > 0) {
        try {
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            
            await page.setRequestInterception(true);
            page.removeAllListeners('request'); 
            page.on('request', (req) => {
                if (['image', 'media', 'font'].includes(req.resourceType()) || req.url().includes('google-analytics')) req.abort();
                else req.continue();
            });

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.bringToFront();
            await sleep(1000);

            // Cookies & Banners
            try { 
                await page.evaluate(() => { 
                    const btn =[...document.querySelectorAll('button, a, div[role="button"]')].find(b => 
                        /αποδοχή|accept|συμφωνώ|συναινώ/i.test(b.textContent || b.innerText)
                    ) || document.querySelector('#onetrust-accept-btn-handler, .cookie-alert-extended-button, .ods-cookie-banner__accept-all');
                    if (btn && btn.offsetParent !== null) btn.click();
                    const banners = document.querySelectorAll('#onetrust-banner-sdk, .cookie-banner,[class*="overlay"]');
                    banners.forEach(b => b.remove());
                }); 
                await sleep(1000); 
            } catch(e){}

            // 🎯 DELEGATION
            switch (storeName) {
                case 'Σκλαβενίτης': await scrapeSklavenitis(page, storeName, config, allFound); break;
                case 'ΑΒ Βασιλόπουλος': await scrapeAB(page, storeName, config, allFound); break;
                case 'Γαλαξίας': await scrapeGalaxias(page, storeName, config, allFound); break;
                case 'MyMarket': await scrapeMyMarket(page, storeName, config, allFound); break;
                case 'Market In': await scrapeMarketIn(page, storeName, config, allFound); break;
                case 'Μασούτης': await scrapeMasoutis(page, storeName, config, allFound); break;
                case 'Κρητικός': await scrapeKritikos(page, storeName, config, allFound); break;
            }

            break; // Επιτυχία! Σπάει το Retry Loop

        } catch (error) {
            retries--;
            if (retries === 0) { console.log(`\n❌ Οριστική Αποτυχία στο ${url}: ${error.message}`); }
            else { await sleep(3000); }
        }
    }

    // 💾 ΑΠΟΘΗΚΕΥΣΗ ΣΤΗ ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ (UPSERT)
    const finalProducts = Array.from(allFound.values());
    
    if (finalProducts.length > 0) {
        const bulkOps = finalProducts.map(product => ({
            updateOne: {
                filter: { normalizedName: product.normalizedName, supermarket: product.supermarket },
                update: { $set: product },
                upsert: true
            }
        }));
        await Product.bulkWrite(bulkOps);
    }

    // 🟢 Ενημέρωση Progress Bar
    completedJobs++;
    drawProgressBar(completedJobs, totalJobs, storeName);
}

// --- ORCHESTRATOR ---
async function runWebScraper(targetStore = null) {
    console.log(`\n🥷 ENTERPRISE STEALTH CLUSTER INITIATED.`);
    globalIsScraping = true; // Ξεκίνησε!
    completedJobs = 0;

    let urlsToScrape =[ ...SKLAVENITIS_URLS, ...MYMARKET_URLS, ...MASOUTIS_URLS, ...KRITIKOS_URLS, ...GALAXIAS_URLS, ...MARKET_IN_URLS ];

    try {
        const jsonPath = path.join(__dirname, '../category_links.json');
        if (fs.existsSync(jsonPath)) {
            const linksData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (linksData['ΑΒ Βασιλόπουλος']) urlsToScrape = urlsToScrape.concat(linksData['ΑΒ Βασιλόπουλος']);
        }
    } catch (e) {}

    let storeMap = urlsToScrape.map(url => {
        if (url.includes('ab.gr')) return { storeName: 'ΑΒ Βασιλόπουλος', url, id: 'ab' };
        if (url.includes('sklavenitis.gr')) return { storeName: 'Σκλαβενίτης', url, id: 'sklavenitis' };
        if (url.includes('mymarket.gr')) return { storeName: 'MyMarket', url, id: 'mymarket' };
        if (url.includes('masoutis.gr')) return { storeName: 'Μασούτης', url, id: 'masoutis' };
        if (url.includes('kritikos-sm.gr')) return { storeName: 'Κρητικός', url, id: 'kritikos' };
        if (url.includes('galaxias.shop')) return { storeName: 'Γαλαξίας', url, id: 'galaxias' };
        if (url.includes('market-in.gr')) return { storeName: 'Market In', url, id: 'marketin' };
        return null;
    }).filter(item => item !== null);

    if (targetStore) {
        const target = targetStore.toLowerCase();
        if (target === 'rest') {
            storeMap = storeMap.filter(s => s.id !== 'ab');
        } else {
            storeMap = storeMap.filter(s => s.id === target || s.storeName.toLowerCase().includes(target));
        }
    }

    totalJobs = storeMap.length;
    if (totalJobs === 0) { console.log("Δεν βρέθηκαν URLs για scraping."); return; }

    console.log(`🚀 Θα σαρωθούν συνολικά ${totalJobs} σελίδες.`);
    drawProgressBar(0, totalJobs, 'Εκκίνηση...');

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_PAGE, 
        maxConcurrency: 6, 
        timeout: 600000, 
        puppeteerOptions: {
            headless: "new",
            defaultViewport: null, 
            args:[
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security', 
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-gpu', 
                '--disable-dev-shm-usage', 
                '--no-first-run', 
                '--no-zygote',
                '--single-process',             
                '--disable-extensions',         
                '--js-flags="--max-old-space-size=256"', 
                '--disable-notifications',      
                '--no-default-browser-check'    
            ]
        }
    });

    cluster.on('taskerror', (err, data) => {}); 

    await cluster.task(scrapeTask);
    storeMap.forEach(data => cluster.queue(data));
    
    await cluster.idle();
    await cluster.close();

    globalIsScraping = false; // Τελείωσε!
    console.log(`\n🎉 ΤΕΛΟΣ: Η Stealth Engine ολοκλήρωσε επιτυχώς όλες τις εργασίες.`);
}

// 🟢 Το API για να βλέπει το Frontend αν τρέχει το Scraper
const getScrapingStatus = () => { return globalIsScraping; };

const startCronJobs = () => { cron.schedule('1 1 * * 1', runWebScraper); };
module.exports = { startCronJobs, runWebScraper, getScrapingStatus };