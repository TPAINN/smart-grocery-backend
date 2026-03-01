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

// Σταθερές URLs (ΜΑΖΙΚΗ ΛΙΣΤΑ)
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

// --- ENTERPRISE CONFIGURATION DICTIONARY ---
const STORE_CONFIGS = {
    'ΑΒ Βασιλόπουλος': {
        type: 'infinite',
        card: 'article,[data-testid^="product-block"]',
        name: '[data-testid="product-name"],[data-testid="product-block-name-link"]',
        price: '.sc-dqia0p-8,[data-testid="product-block-price"]',
        promo: '[data-testid="tag-promo-label"]',
        loader: '[data-testid="loading-spinner-animation"],[data-testid="loading-spinner"]'
    },
    'Σκλαβενίτης': {
        type: 'infinite',
        card: '.product, li.item, .product-list > div, .product-card',
        name: 'h4 a, h4, .product__title a, .product__name a',
        price: '.price, [data-price]',
        oldPrice: 'del, .price.old',
        promo: '.offer-span, .text-minus',
        loader: null
    },
    'Κρητικός': {
        type: 'infinite',
        card: '[class*="ProductListItem_root"], div[class*="ProductListItem"]',
        name: '[class*="ProductListItem_title"]',
        price: '[class*="ProductListItem_finalPrice"]',
        promo: '[class*="ProductListItem_badgeOffer"]',
        loader: null
    },
    'MyMarket': {
        type: 'pagination',
        card: 'article, .product, .product-item, .product-card, .products-listing > div, div.relative.flex.flex-col',
        name: '.line-clamp-2',
        price: '.font-semibold:not(.diagonal-line), .price',
        oldPrice: '.diagonal-line',
        promo: '.product-note-tag',
        nextBtn: 'a[rel="next"], [data-mkey="next"]'
    },
    'Μασούτης': {
        type: 'infinite',
        card: '.product-item, .col-product',
        name: '.productTitle',
        price: '.price',
        promo: '.pDscntPercent',
        loader: '.lds-spinner'
    },
    'Market In': {
        type: 'pagination',
        card: '.product-grid-box, .product',
        name: '.product-ttl',
        price: '.new-price',
        oldPrice: '.old-price',
        promo: '.disc-value',
        nextBtn: 'span.material-icons, a.next' 
    },
    'Γαλαξίας': {
        type: 'infinite',
        card: '.product-card, .col',
        name: '.text-black-i, h2',
        price: 'span[style*="rgb(2, 88, 165)"]',
        promo: '.bg-secondary.text-primary',
        loader: '.loadspinner'
    }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- UNIVERSAL EVALUATE EXTRACTOR (Τρέχει μέσα στον Browser) ---
const extractDataInBrowser = (storeName, config) => {
    const products =[];
    const parsePrice = (text) => {
        if (!text) return null;
        // Πιάνει τα πάντα! Και 12,59€* και 12.- 
        const raw = text.replace(/[^\d,.-]/g, '').replace(',', '.');
        const match = raw.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
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

        // 🔥 FIX: Χρησιμοποιούμε textContent για να διαβάζει και τα "αόρατα" προϊόντα της Vue.js!
        const nameEl = card.querySelector(config.name) || card.querySelector('h2, h3, h4, [class*="title"],[data-qa-label*="title"]');
        if (nameEl) name = (nameEl.textContent || nameEl.innerText || '').trim();
        if (!name && storeName === 'ΑΒ Βασιλόπουλος') {
            const abName = card.querySelector('[data-testid="product-name"]');
            if (abName) name = (abName.textContent || '').trim();
        }

        const priceEl = card.querySelector(config.price) || card.querySelector('[class*="price"]');
        if (priceEl) priceNum = parsePrice(priceEl.textContent || priceEl.innerText);
        
        if (!priceNum && storeName === 'ΑΒ Βασιλόπουλος' && priceEl) {
            const rawText = (priceEl.textContent || '').replace(/\D/g, ''); 
            if (rawText.length >= 3) priceNum = parseInt(rawText) / 100;
        }

        if (config.oldPrice) {
            const oldPriceEl = card.querySelector(config.oldPrice);
            if (oldPriceEl) oldPriceNum = parsePrice(oldPriceEl.textContent || oldPriceEl.innerText);
        }

        if (config.promo) {
            const promos = card.querySelectorAll(config.promo);
            promos.forEach(p => {
                const pText = (p.textContent || p.innerText || '').toLowerCase();
                if (pText.includes('%') || pText.includes('-') || pText.includes('super')) isSale = true;
                if (pText.includes('1+1') || pText.includes('δωρο')) { is1plus1 = true; isSale = true; }
            });
        }

        // 🎯 THE ULTIMATE LIDL FALLBACKS:
        if (!priceNum) {
            const allSpans = Array.from(card.querySelectorAll('span, div, strong'));
            const euroSpan = allSpans.find(el => (el.textContent || '').includes('€') && /\d/.test(el.textContent));
            if (euroSpan) priceNum = parsePrice(euroSpan.textContent);
        }
        
        if (!name && storeName === 'Lidl') {
            const possibleTitle = Array.from(card.querySelectorAll('h3, h2, h4, div, span')).find(el => {
                const txt = (el.textContent || '').trim();
                return txt.length > 4 && !txt.includes('€') && isNaN(parseInt(txt[0]));
            });
            if (possibleTitle) name = (possibleTitle.textContent || '').trim();
        }

        const imgEl = card.querySelector('img');
        if (imgEl) imgUrl = imgEl.src || imgEl.getAttribute('data-src');

        if (name && priceNum && priceNum > 0) {
            name = name.replace(/(το τεμάχιο|το τεμαχιο|συσκευασία|συσκευασια)/gi, '').trim();
            const normalizedName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            products.push({
                name, normalizedName, supermarket: storeName, price: priceNum, oldPrice: oldPriceNum,
                isOnSale: isSale, is1plus1: is1plus1, imageUrl: imgUrl
            });
        }
    });
    return products;
};

// --- THE CLUSTER WORKER ---
async function scrapeTask({ page, data: { url, storeName } }) {
    console.log(`\n⚡[${storeName}] Ξεκινάει: ${url}`);
    const config = STORE_CONFIGS[storeName] || STORE_CONFIGS['Σκλαβενίτης']; 
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // 🚫 ΜΠΛΟΚΑΡΙΣΜΑ ΕΙΚΟΝΩΝ & ΠΟΡΩΝ (Μέγιστη Ταχύτητα, αλλά ΑΦΗΝΟΥΜΕ τα Stylesheets!)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        // Η λέξη 'stylesheet' ΕΧΕΙ ΑΦΑΙΡΕΘΕΙ!
        if (['image', 'media', 'font'].includes(req.resourceType()) || req.url().includes('google-analytics')) req.abort();
        else req.continue();
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 🎯 ΑΠΟΛΥΤΩΣ ΑΣΦΑΛΕΣ FOCUS (Βάσει Puppeteer Standards)
        await page.bringToFront(); // Φέρνει τη σελίδα στο προσκήνιο
        await page.mouse.click(0, 0).catch(e => {}); // Κλικ στο (0,0) - τέρμα πάνω αριστερά, στο απόλυτο κενό!
        await page.focus('body').catch(e => {}); // Κλειδώνει το πληκτρολόγιο στο σώμα της σελίδας
        await sleep(500);

        // 🧠 SMART WAIT (Περιμένουμε να φορτώσουν τα πρώτα προϊόντα)
        try {
            process.stdout.write(`\r   ⏳ Αναμονή για το API... `);
            await page.waitForFunction((nameSelector) => {
                return document.querySelector(nameSelector) !== null;
            }, { timeout: 15000 }, config.name);
            process.stdout.write(`\r   ✅ Τα προϊόντα φορτώθηκαν!        \n`);
        } catch (e) {}

        // 🍪 ΑΥΤΟΜΑΤΗ ΑΠΟΔΟΧΗ COOKIES - ALL SITES
        try { 
            await page.evaluate(() => { 
                const btn = [...document.querySelectorAll('button, a, div[role="button"]')].find(b => 
                    /αποδοχή|accept|συμφωνώ|συναινώ/i.test(b.textContent || b.innerText)
                ) || document.querySelector('#onetrust-accept-btn-handler, .cookie-alert-extended-button, .ods-cookie-banner__accept-all, .ods-button--primary');
                
                if (btn && btn.offsetParent !== null) btn.click();
            }); 
            await sleep(1500); 
        } catch(e){}

        let allFound = new Map();
        let keepGoing = true;
        let lastFoundTime = Date.now(); 

        while (keepGoing) {
            try {
                const products = await page.evaluate(extractDataInBrowser, storeName, config);
                
                let newFound = false;
                products.forEach(p => {
                    const key = p.normalizedName + p.price;
                    if (!allFound.has(key)) {
                        allFound.set(key, p);
                        newFound = true; 
                    }
                });

                if (newFound) {
                    lastFoundTime = Date.now(); 
                    process.stdout.write(`\r   📦 Σύνολο: ${allFound.size} προϊόντα... `);
                }

                // 🛑 ΕΛΕΓΧΟΣ ΑΥΣΤΗΡΟΥ TIMEOUT (20 Δευτερόλεπτα απραξίας -> ΤΕΛΟΣ)
                if (Date.now() - lastFoundTime > 20000) {
                    console.log(`\n🛑[${storeName}] 20 δευτερόλεπτα απραξίας. Ήρθε το τέλος!`);
                    break; 
                }

                // --- NAVIGATION ΜΗΧΑΝΙΣΜΟΣ ---
                if (config.type === 'pagination') {
                    if (newFound || (Date.now() - lastFoundTime > 2500)) { 
                        const hasNext = await page.evaluate((selector) => {
                            const btns = Array.from(document.querySelectorAll(selector));
                            for (let btn of btns) {
                                if (btn && !btn.disabled && btn.offsetParent !== null) {
                                                                        if(btn.innerText.includes('keyboard_arrow_right') || btn.tagName === 'A') {
                                        btn.click();
                                        return true;
                                    }
                                }
                            }
                            return false;
                        }, config.nextBtn);

                        if (hasNext) {
                            process.stdout.write(`\r➡️ [${storeName}] Πάτησα "Επόμενη Σελίδα". Φορτώνει... `);
                            lastFoundTime = Date.now() + 3000; 
                            await sleep(2000); 
                        } else {
                            keepGoing = false; 
                        }
                    } else {
                        await sleep(200); 
                    }

                } else {
                    // --- INFINITE SCROLL & COUNTERS ---
                    const scrollStatus = await page.evaluate(async (cfg) => {
                        let forcedScroll = false, isFinished = false;

                        // Σκλαβενίτης Counter
                        const pageInfo = document.querySelector('span.current-page');
                        if (pageInfo) {
                            const match = pageInfo.innerText.match(/(\d+)\s*από\s*τα\s*(\d+)/);
                            if (match && parseInt(match[1]) >= parseInt(match[2])) isFinished = true;
                            else forcedScroll = true;
                        }

                        // Γενικό Next Arrow
                        const nextArrow = document.querySelector('pagination-controls .pagination-next:not(.disabled) a, .ngx-pagination .current + li a');
                        if (nextArrow && nextArrow.offsetParent !== null) {
                            nextArrow.click();
                            forcedScroll = true; 
                        }
                        
                        return { forcedScroll, isDone: isFinished };
                    }, config);

                    if (scrollStatus.isDone) {
                        console.log(`\n🏁 [${storeName}] Διαβάστηκαν όλα τα προϊόντα!`);
                        break; 
                    }

                    if (scrollStatus.forcedScroll) {
                        lastFoundTime = Date.now(); 
                        await sleep(500);
                    } else {
                        await sleep(100); 
                    }

                    // NATIVE SCROLL ΓΙΑ ΤΑ ΥΠΟΛΟΙΠΑ
                    await page.focus('body').catch(e=>{});
                    if (storeName === 'Γαλαξίας') {
                        for (let i = 0; i < 25; i++) { await page.keyboard.press('PageDown'); await sleep(40); }
                        await page.keyboard.press('PageUp'); await sleep(100); await page.keyboard.press('PageDown');
                    } else {
                        await page.keyboard.press('Space').catch(e=>{});
                        await sleep(50);
                        for (let i = 0; i < 6; i++) { await page.keyboard.press('PageDown'); await sleep(100); }
                    }
                }
            } catch (loopError) {
                if (loopError.message.includes('Execution context was destroyed') || loopError.message.includes('Target closed') || loopError.message.includes('detached Frame')) {
                    console.log(`🔄 [${storeName}] Η σελίδα άλλαξε. Επανασύνδεση...`);
                    lastFoundTime = Date.now(); 
                    await sleep(2000); 
                    continue; 
                } else {
                    console.log(`\n⚠️ Διακοπή λούπας: ${loopError.message}. Αποθήκευση όσων βρέθηκαν...`);
                    break; 
                }
            }
        } 

        // --- ΑΠΟΘΗΚΕΥΣΗ ΣΤΗ ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ ---
        const finalProducts = Array.from(allFound.values());
        console.log(`\n✔️  Ολοκληρώθηκε! Βρέθηκαν ${finalProducts.length} προϊόντα.`);

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

    } catch (error) {
        console.log(`\n❌ Σφάλμα στο ${storeName}: ${error.message}`);
    }
}

// --- ORCHESTRATOR ---
async function runWebScraper(targetStore = null) {
    console.log(`\n🥷 ENTERPRISE STEALTH CLUSTER INITIATED.`);

    let urlsToScrape =[
        ...SKLAVENITIS_URLS, ...MYMARKET_URLS, ...MASOUTIS_URLS, ...KRITIKOS_URLS, ...GALAXIAS_URLS, ...MARKET_IN_URLS
    ];

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
        storeMap = storeMap.filter(s => 
            s.id === target || // 🔥 FIX: Απόλυτη ταύτιση με το ID
            s.storeName.toLowerCase().includes(target)
        );
    }

    if (storeMap.length === 0) {
        console.log("Δεν βρέθηκαν URLs για scraping.");
        return;
    }

    // --- ΔΗΜΙΟΥΡΓΙΑ ΤΟΥ CLUSTER (STEALTH / INVISIBLE MODE) ---
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_PAGE, 
        maxConcurrency: 2, 
        timeout: 600000, 
        puppeteerOptions: {
            headless: "new",
            defaultViewport: null, 
            args:[
                '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Βοηθά στην αποφυγή bot detection
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-gpu', // Λιγότερη χρήση CPU/RAM
            '--disable-dev-shm-usage', // Απαραίτητο για Docker/Linux για αποφυγή crashes
            '--no-first-run',
            '--no-zygote'
            ]
        }
    });

    cluster.on('taskerror', (err, data) => {
        console.log(`\n❌ Κρίσιμο Σφάλμα στο ${data.storeName}: ${err.message}`);
    });

    await cluster.task(scrapeTask);

    storeMap.forEach(data => cluster.queue(data));

    await cluster.idle();
    await cluster.close();

    console.log(`\n🎉 ΤΕΛΟΣ: Η Stealth Engine ολοκλήρωσε επιτυχώς όλες τις εργασίες.`);
}

const startCronJobs = () => { cron.schedule('1 1 * * 1', runWebScraper); };
module.exports = { startCronJobs, runWebScraper };