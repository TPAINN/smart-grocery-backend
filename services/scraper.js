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
    "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/psomi-artoskeyasmata/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/psomi-typopoiimeno/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/pites-tortigies/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/kritsinia-paximadia-fryganies/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/koyloyria-voytimata/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/keik-tsoyrekia-kroyasan/", "https://www.sklavenitis.gr/eidi-artozacharoplasteioy/glyka/", "https://www.sklavenitis.gr/freska-froyta-lachanika/froyta/", "https://www.sklavenitis.gr/freska-froyta-lachanika/lachanika/", "https://www.sklavenitis.gr/freska-froyta-lachanika/kommena-lahanika/", "https://www.sklavenitis.gr/fresko-psari-thalassina/psaria-ichthyokalliergeias/", "https://www.sklavenitis.gr/fresko-psari-thalassina/chtapodia-kalamaria-soypies/", "https://www.sklavenitis.gr/fresko-psari-thalassina/ostrakoeidi/", "https://www.sklavenitis.gr/fresko-kreas/fresko-moschari/", "https://www.sklavenitis.gr/fresko-kreas/fresko-choirino/", "https://www.sklavenitis.gr/fresko-kreas/freska-poylerika/", "https://www.sklavenitis.gr/fresko-kreas/freska-arnia-katsikia/", "https://www.sklavenitis.gr/fresko-kreas/freska-paraskeyasmata-kreaton-poylerikon/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/galata-psygeioy/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/galata-sokolatoycha-psygeioy/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/futika-alla-rofimata-psugeiou/", "https://www.sklavenitis.gr/galata-rofimata-chymoi-psygeioy/chymoi-tsai-psygeioy/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/giaoyrtia/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/giaoyrtia-vrefika-paidika/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/epidorpia-giaoyrtioy/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/fytika-epidorpia/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/ryzogala-glykismata-psygeioy/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/proteinouha-giaoyrtia-epidorpia-glykismata-psygeiou/", "https://www.sklavenitis.gr/giaoyrtia-kremes-galaktos-epidorpia-psygeioy/kremes-galaktos-santigi/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/feta-leyka-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/malaka-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/imisklira-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/sklira-tyria/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/tyria-aleifomena-mini-tyrakia/", "https://www.sklavenitis.gr/turokomika-futika-anapliromata/futika-anapliromata/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/ayga/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/voytyra/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/margarines/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/zymes-nopes/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/freska-zymarika-saltses/", "https://www.sklavenitis.gr/ayga-voytyro-nopes-zymes-zomoi/zomoi-psygeioy/", "https://www.sklavenitis.gr/allantika/allantika-galopoylas-kotopoyloy/", "https://www.sklavenitis.gr/allantika/zampon-mpeikon-omoplati/", "https://www.sklavenitis.gr/allantika/pariza-mortadela/", "https://www.sklavenitis.gr/allantika/salamia/", "https://www.sklavenitis.gr/allantika/loykanika/", "https://www.sklavenitis.gr/allantika/paradosiaka-allantika/", "https://www.sklavenitis.gr/allantika/set-allantikon-tyrion/", "https://www.sklavenitis.gr/orektika-delicatessen/psaria-pasta-se-ladi/", "https://www.sklavenitis.gr/orektika-delicatessen/kapnista-psaria/", "https://www.sklavenitis.gr/orektika-delicatessen/delicatessen-thalassinon/", "https://www.sklavenitis.gr/orektika-delicatessen/pate-foie-gras/", "https://www.sklavenitis.gr/orektika-delicatessen/salates-aloifes/", "https://www.sklavenitis.gr/orektika-delicatessen/elies/", "https://www.sklavenitis.gr/orektika-delicatessen/toyrsia-liastes-tomates/", "https://www.sklavenitis.gr/orektika-delicatessen/chalvades/", "https://www.sklavenitis.gr/etoima-geymata/geymata-me-kreas-poylerika/", "https://www.sklavenitis.gr/etoima-geymata/geymata-me-psaria-thalassina-sushi/", "https://www.sklavenitis.gr/etoima-geymata/geymata-osprion-lachanikon/", "https://www.sklavenitis.gr/etoima-geymata/ladera/", "https://www.sklavenitis.gr/etoima-geymata/geymata-zymarikon-ryzioy/", "https://www.sklavenitis.gr/etoima-geymata/soupes/", "https://www.sklavenitis.gr/etoima-geymata/etoimes-salates-synodeytika-geymaton/", "https://www.sklavenitis.gr/etoima-geymata/santoyits/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-lachanika-froyta/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-psaria-thalassina/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-kreata-poylerika/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-fytika-anapliromata/", "https://www.sklavenitis.gr/katepsygmena/katepsygmena-geymata/", "https://www.sklavenitis.gr/katepsygmena/katepsygmenes-zymes-pites-pitses/", "https://www.sklavenitis.gr/katepsygmena/pagota-pagakia/", "https://www.sklavenitis.gr/kava/pota/", "https://www.sklavenitis.gr/kava/krasia-sampanies/", "https://www.sklavenitis.gr/kava/mpires-milites/", "https://www.sklavenitis.gr/anapsyktika-nera-chymoi/nera/", "https://www.sklavenitis.gr/anapsyktika-nera-chymoi/anapsyktika-sodes-energeiaka-pota/", "https://www.sklavenitis.gr/anapsyktika-nera-chymoi/chymoi/", "https://www.sklavenitis.gr/xiroi-karpoi-snak/xiroi-karpoi-apoxiramena-froyta/", "https://www.sklavenitis.gr/xiroi-karpoi-snak/patatakia-garidakia-alla-snak/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/mpiskota/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/sokolates/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/pastelia-mantolata-loykoymia/", "https://www.sklavenitis.gr/mpiskota-sokolates-zacharodi/tsichles-karameles-gleifitzoyria/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/galata-fytika-rofimata-makras-diarkeias/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/dimitriaka-mpares/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/kafedes-rofimata-afepsimata/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/melia-marmelades/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/pralines-tachini-fystikovoytyro/", "https://www.sklavenitis.gr/eidi-proinoy-rofimata/proteines-se-skoni/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefika-paidika-galata/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefika-paidika-fagita/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefikes-paidikes-kremes/", "https://www.sklavenitis.gr/vrefikes-paidikes-trofes/vrefika-paidika-snak/", "https://www.sklavenitis.gr/trofima-pantopoleioy/aleyria-simigdalia/", "https://www.sklavenitis.gr/trofima-pantopoleioy/zachari-ypokatastata-zacharis/", "https://www.sklavenitis.gr/trofima-pantopoleioy/zymarika/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ketsap-moystardes-magionezes-etoimes-saltses/", "https://www.sklavenitis.gr/trofima-pantopoleioy/konserves-kompostes/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ladia-lipi/", "https://www.sklavenitis.gr/trofima-pantopoleioy/mpacharika-alatia-xidia-zomoi/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ryzia/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ospria/", "https://www.sklavenitis.gr/trofima-pantopoleioy/sitari-kinoa-sogia-alla-dimitriaka/", "https://www.sklavenitis.gr/trofima-pantopoleioy/poyredes-soypes-noodles/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ntomatika/", "https://www.sklavenitis.gr/trofima-pantopoleioy/ylika-mageirikis-zacharoplastikis/", "https://www.sklavenitis.gr/trofima-pantopoleioy/meigmata-gia-zele-glyka/", "https://www.sklavenitis.gr/trofes-eidi-gia-katoikidia/trofes-eidi-gia-skyloys/", "https://www.sklavenitis.gr/trofes-eidi-gia-katoikidia/trofes-eidi-gia-gates/", "https://www.sklavenitis.gr/trofes-eidi-gia-katoikidia/trofes-eidi-gia-ptina-psaria-alla-katoikidia/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/eidi-syntirisis-psisimatos-trofimon/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/sakoyles-aporrimmaton/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/kalamakia-odontoglyfides/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/servitsia-mias-chrisis/", "https://www.sklavenitis.gr/eidi-mias-chrisis-eidi-parti/eidi-parti/", "https://www.sklavenitis.gr/chartika-panes-servietes/chartika/", "https://www.sklavenitis.gr/chartika-panes-servietes/servietes-panes-enilikon/", "https://www.sklavenitis.gr/chartika-panes-servietes/vrefikes-paidikes-panes-moromantila/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/frontida-mallion/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/frontida-somatos/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/eidi-xyrismatos-after-shave/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/stomatiki-ygieini/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/ygieini-peripoiisi-prosopoy/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/makigiaz-vernikia-nychion/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/vrefika-paidika-kallyntika/", "https://www.sklavenitis.gr/kallyntika-eidi-prosopikis-ygieinis/parafarmakeytika-eidi/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/aporrypantika-roychon/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/aporrypantika-piaton/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/katharistika-genikis-chrisis/", "https://www.sklavenitis.gr/aporrypantika-eidi-katharismoy/synerga-katharismoy/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/eidi-sideromatos-aplomatos/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/fylaxi-peripoiisi-roychon/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/peripoiisi-ypodimaton/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/aromatika-horou-sullektes-ugrasias-filtra-aporrofitira/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/entomoapothitika-entomoktona/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/kausimes-ules/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/eidi-ugraeriou-anaptires-spirta/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/eidi-thymiamatos/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/mpataries-lampes-ilektrologika-eidi-tainies/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/isothermikes-tsades-karotsia-laikis/", "https://www.sklavenitis.gr/eidi-oikiakis-chrisis/ilektrikes-mikrosuskeues/", "https://www.sklavenitis.gr/chartopoleio/grafiki-yli-organosi-grafeioy/", "https://www.sklavenitis.gr/chartopoleio/tetradia-blok-fakeloi-harti-fototypiko/"
];
const MYMARKET_URLS =[
    "https://www.mymarket.gr/frouta-lachanika", "https://www.mymarket.gr/fresko-kreas-psari", "https://www.mymarket.gr/galaktokomika-eidi-psygeiou", "https://www.mymarket.gr/tyria-allantika-deli", "https://www.mymarket.gr/katepsygmena-trofima", "https://www.mymarket.gr/mpyres-anapsyktika-krasia-pota", "https://www.mymarket.gr/proino-rofimata-kafes", "https://www.mymarket.gr/artozacharoplasteio-snacks", "https://www.mymarket.gr/trofima", "https://www.mymarket.gr/frontida-gia-to-moro-sas", "https://www.mymarket.gr/prosopiki-frontida", "https://www.mymarket.gr/oikiaki-frontida-chartika", "https://www.mymarket.gr/kouzina-mikrosyskeves-spiti", "https://www.mymarket.gr/frontida-gia-to-katoikidio-sas", "https://www.mymarket.gr/epochiaka", "https://www.mymarket.gr/viral-trends", "https://www.mymarket.gr/vegan-epiloges-sta-my-market"
];
const MASOUTIS_URLS =[
    // Promotional / featured pages
    "https://www.masoutis.gr/categories/index/prosfores?item=0",
    "https://www.masoutis.gr/categories/index/nea-proionta?item=11",
    "https://www.masoutis.gr/categories/index/meiwsh-timhs?item=9",
    "https://www.masoutis.gr/categories/index/proionta-masouths?item=2",
    // Full grocery categories
    "https://www.masoutis.gr/categories/index/freska-froyta-kai-lachanika",
    "https://www.masoutis.gr/categories/index/fresko-kreas",
    "https://www.masoutis.gr/categories/index/ichtyes-thalassina",
    "https://www.masoutis.gr/categories/index/galaktokomika-auga",
    "https://www.masoutis.gr/categories/index/tyria-allantika",
    "https://www.masoutis.gr/categories/index/psomi-alopolia",
    "https://www.masoutis.gr/categories/index/katepsygmena",
    "https://www.masoutis.gr/categories/index/pantopoleio",
    "https://www.masoutis.gr/categories/index/zymarika-rizi-osprya",
    "https://www.masoutis.gr/categories/index/konserves",
    "https://www.masoutis.gr/categories/index/anapsyktika-nera-chymoi",
    "https://www.masoutis.gr/categories/index/kava",
    "https://www.masoutis.gr/categories/index/proinoy-glykismata",
    "https://www.masoutis.gr/categories/index/snaks-xiroi-karpoi",
    "https://www.masoutis.gr/categories/index/mpaharia-souses-ladia",
    "https://www.masoutis.gr/categories/index/kafes-rofimata",
    "https://www.masoutis.gr/categories/index/vrefika-paidika",
    "https://www.masoutis.gr/categories/index/prosopiki-frontida",
    "https://www.masoutis.gr/categories/index/kathariothta-oikiaka",
    "https://www.masoutis.gr/categories/index/katoikidia",
];
const KRITIKOS_URLS =[
    "https://kritikos-sm.gr/offers/", "https://kritikos-sm.gr/categories/manabikh/", "https://kritikos-sm.gr/categories/fresko-kreas/", "https://kritikos-sm.gr/categories/allantika/", "https://kritikos-sm.gr/categories/turokomika/", "https://kritikos-sm.gr/categories/galaktokomika/", "https://kritikos-sm.gr/categories/eidh-psugeiou/", "https://kritikos-sm.gr/categories/katapsuxh/", "https://kritikos-sm.gr/categories/pantopwleio/", "https://kritikos-sm.gr/categories/kaba/", "https://kritikos-sm.gr/categories/proswpikh-frontida/", "https://kritikos-sm.gr/categories/brefika/", "https://kritikos-sm.gr/categories/kathariothta/", "https://kritikos-sm.gr/categories/oikiakh-xrhsh/", "https://kritikos-sm.gr/categories/pet-shop/", "https://kritikos-sm.gr/categories/biologikaleitourgika/"
];

/*
 * Category ids verified against the live tree on 2026-08-30 via
 *   {categoriesTwoLevelList(category_id: 2) {id name products_count sub_categories{...}}}
 * on https://galaxias.shop/api/graphql — the same endpoint the site itself uses.
 *
 * The list is complete: all 19 live subcategories appear below, covering 7,573
 * of the 7,698 products the root category reports. The labels here had drifted
 * badly — every single one named a different category than its id actually
 * serves — which reads like whole sections are missing when they are not.
 * Regenerate this block from that query rather than editing names by hand.
 */
const GALAXIAS_URLS =[
    "https://galaxias.shop/eshop/59",            // Τρόφιμα (1183 products)
    "https://galaxias.shop/eshop/69",            // Είδη Ψυγείου (578 products)
    "https://galaxias.shop/eshop/194",           // Τυριά, Αλλαντικά (380 products)
    "https://galaxias.shop/eshop/95",            // Κατεψυγμένα (318 products)
    "https://galaxias.shop/eshop/66",            // Έτοιμα Γεύματα (83 products)
    "https://galaxias.shop/eshop/104",           // Σνακς (780 products)
    "https://galaxias.shop/eshop/68",            // Είδη Πρωϊνού (278 products)
    "https://galaxias.shop/eshop/103",           // Αρτοποιείο (278 products)
    "https://galaxias.shop/eshop/1080515",       // Ροφήματα (238 products)
    "https://galaxias.shop/eshop/89",            // Αναψυκτικά, Χυμοί (388 products)
    "https://galaxias.shop/eshop/88",            // Κάβα (301 products)
    "https://galaxias.shop/eshop/788",           // Βρεφικές Τροφές (46 products)
    "https://galaxias.shop/eshop/342",           // Μαναβική (204 products)
    "https://galaxias.shop/eshop/93",            // Ψαρικά, Κρέας (77 products)
    "https://galaxias.shop/eshop/75",            // Προσωπική Υγιεινή (1266 products)
    "https://galaxias.shop/eshop/64",            // Απορρυπαντικά (632 products)
    "https://galaxias.shop/eshop/72",            // Οικιακής Χρήσης (365 products)
    "https://galaxias.shop/eshop/245",           // Είδη Πάρτι (20 products)
    "https://galaxias.shop/eshop/86",            // Κατοικίδια (158 products)
    "https://galaxias.shop/eshop/76",            // stale id — no longer a top-level category
    "https://galaxias.shop/eshop/77",            // stale id — no longer a top-level category
    "https://galaxias.shop/eshop/78",            // stale id — no longer a top-level category
];
const MARKET_IN_URLS =[
    "https://www.market-in.gr/el-gr/manabikh",
    "https://www.market-in.gr/el-gr/kreopoleio-1",
    "https://www.market-in.gr/el-gr/tyrokomika-allantika",
    "https://www.market-in.gr/el-gr/trofima",
    "https://www.market-in.gr/el-gr/kava",
    "https://www.market-in.gr/el-gr/vrefika",
    "https://www.market-in.gr/el-gr/galaktokomika-proionta-psugeiou",
    "https://www.market-in.gr/el-gr/katepsugmena",
    "https://www.market-in.gr/el-gr/prosopikh-frontida",
    "https://www.market-in.gr/el-gr/kathariothta",
    "https://www.market-in.gr/el-gr/ola-gia-to-spiti",
    "https://www.market-in.gr/el-gr/katoikidia",
    "https://www.market-in.gr/el-gr/prosfores",
    "https://www.market-in.gr/el-gr/psari-thalassina",
];
const LIDL_URLS = [
    // Main food category (loads ALL food with load-more pagination)
    "https://www.lidl-hellas.gr/c/fagito-poto/s10068374",               // Φαγητό & Ποτό
    // Non-food categories
    "https://www.lidl-hellas.gr/c/koyzina-oikiakos-exoplismos/s10068166", // Κουζίνα & Οικιακός
    "https://www.lidl-hellas.gr/c/ergaleia-eidi-kipoy/s10068222",         // Εργαλεία & Είδη Κήπου
    "https://www.lidl-hellas.gr/c/athlitiki-endysi-anapsychi/s10068226",  // Αθλητισμός
    "https://www.lidl-hellas.gr/c/oikiakos-exoplismos/s10068371",         // Οικιακός Εξοπλισμός
    "https://www.lidl-hellas.gr/c/moda-axesoyar/s10068373",               // Μόδα & Αξεσουάρ
    "https://www.lidl-hellas.gr/c/vrefika-paidika-eidi/s10068225",        // Βρεφικά & Παιδικά
];

// ΑΒ Βασιλόπουλος — hardcoded category URLs (replaces category_links.json dependency)
const AB_URLS = [
    "https://www.ab.gr/el/eshop/Oporopoleio/c/001",                                            // Οπωροπωλείο
    "https://www.ab.gr/el/eshop/Fresko-Kreas-and-Psaria/c/002",                                // Φρέσκο Κρέας & Ψάρια
    "https://www.ab.gr/el/eshop/Galaktokomika-Fytika-Rofimata-and-Eidi-Psygeioy/c/003",       // Γαλακτοκομικά & Ψυγείο
    "https://www.ab.gr/el/eshop/Tyria-Fytika-Anapliromata-and-Allantika/c/004",               // Τυριά & Αλλαντικά
    "https://www.ab.gr/el/eshop/Katepsygmena-trofima/c/005",                                   // Κατεψυγμένα
    "https://www.ab.gr/el/eshop/Artos-Zacharoplasteio/c/006",                                  // Άρτος & Ζαχαροπλαστείο
    "https://www.ab.gr/el/eshop/Etoima-Geymata/c/007",                                         // Έτοιμα Γεύματα
    "https://www.ab.gr/el/eshop/Kava-anapsyktika-nera-xiroi-karpoi/c/008",                    // Κάβα & Αναψυκτικά
    "https://www.ab.gr/el/eshop/Proino-snacking-and-rofimata/c/009",                           // Πρωινό & Ροφήματα
    "https://www.ab.gr/el/eshop/Vasika-typopoiimena-trofima/c/010",                            // Βασικά τυποποιημένα τρόφιμα
    "https://www.ab.gr/el/eshop/Ola-gia-to-moro/c/011",                                        // Όλα για το μωρό
    "https://www.ab.gr/el/eshop/Eidi-prosopikis-peripoiisis/c/012",                            // Είδη προσωπικής περιποίησης
    "https://www.ab.gr/el/eshop/Katharistika-Chartika-and-eidi-spitioy/c/013",                // Καθαριστικά & Χαρτικά
    "https://www.ab.gr/el/eshop/Gia-katoikidia/c/014",                                         // Για κατοικίδια
    "https://www.ab.gr/el/eshop/Healthy-Corner/c/019",                                         // Healthy Corner
];

const STORE_CONFIGS = {
    'ΑΒ Βασιλόπουλος': {
        card: '[data-testid="product-block"]',
        name: '[data-testid="product-name"], [data-testid="product-block-name-link"]',
        price: '[data-testid="product-block-price"]',
        oldPrice: '[data-testid="product-block-old-price"]',
        promo: '[data-testid="tag-promo-label"]',
        img: 'img[data-testid="product-block-image"], img[data-testid="product-image"], picture img, img[src*="static.ab.gr"]',
    },
    'Σκλαβενίτης': { card: '.product, li.item, .product-list > div, .product-card', name: 'h4 a, h4, .product__title a, .product__name a', price: '.price, [data-price]', oldPrice: 'del, .price.old', promo: '.offer-span, .text-minus', img: '.product__figure img, figure img, img[src*="static.sklavenitis"]' },
    'Κρητικός': {
        card: '[class*="ProductListItem_productItem"]',
        name: '[class*="ProductListItem_title__"]',
        price: '[class*="ProductListItem_finalPrice__"]',
        oldPrice: '[class*="ProductListItem_beginPrice"]',
        promo: '[class*="ProductListItem_badge"]',
        img: 'img[class*="ProductListItem_productImage"], [class*="ProductListItem"] img'
    },
    'MyMarket': { card: 'article.product--teaser', name: '.line-clamp-2', oldPrice: '.diagonal-line', promo: '.product-note-tag, [class*="badge-promo"], [class*="offer-label"]', nextBtn: 'a[rel="next"]', img: '.teaser-image-container img, picture img, img[loading="lazy"]' },
    'Μασούτης': { card: '.product', name: '.productTitle', price: '.pStartPrice', oldPrice: '.pStartPrice', promo: '.pDscntPercent', loader: '.lds-spinner', img: '.productImage, .catImgCont img, img' },
    'Market In': { card: '.product-grid-box, .product', name: '.product-ttl', price: '.new-price', oldPrice: '.old-price', promo: '.disc-value', nextBtn: 'span.material-icons, a.next', img: '.product-thumb img, img[src*="market-in"]' },
    'Γαλαξίας': { card: 'product-card', name: 'a.text-black-i', price: 'span[style*="rgb(2, 88, 165)"], .current-price, .price-label, [class*="price"]:not([class*="old"]):not([class*="base"])', promo: '.bg-secondary.text-primary', img: 'img[src*="galaxias"], img[src*="api/media"], img[data-src*="galaxias"], img[lazy-src*="galaxias"], product-card img' },
    'Lidl': {
        card: '.odsc-tile, .product-grid-box',
        name: '.product-grid-box__title',
        price: '.ods-price__value',
        oldPrice: '.ods-price__strikethrough .ods-price__value',
        promo: '.ods-price__box-content-text-el',
        availability: '.ods-badge__label',
        loadMore: '.s-load-more__button',
        img: 'img[src*="lidl"], img[data-src*="lidl"], img.odsc-image-gallery__image, img[class*="product"], picture img, img[loading="lazy"]',
    },
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
        // Remove € and normalize whitespace
        const cleaned = text.replace(/€/g, '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return null;

        // Standard decimal: "1,23" or "1.23" or "€2,25" → after cleaning "2,25"
        const decimalMatch = cleaned.match(/^(\d+)[,.](\d+)/);
        if (decimalMatch) {
            const result = parseFloat(`${decimalMatch[1]}.${decimalMatch[2]}`);
            return result > 300 ? result / 100 : result;
        }

        // ΑΒ split format: "1 10" = €1.10 (euros + 2-digit cents as separate DOM nodes)
        const splitMatch = cleaned.match(/^(\d+)\s+(\d{1,2})$/);
        if (splitMatch) {
            return parseInt(splitMatch[1], 10) + parseInt(splitMatch[2], 10) / 100;
        }

        // Integer only (large = cents)
        const intMatch = cleaned.match(/^(\d+)$/);
        if (intMatch) {
            const num = parseInt(intMatch[1], 10);
            return num > 99 ? num / 100 : num;
        }

        return null;
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
        let nameEl = card.querySelector(config.name) || card.querySelector('h2, h3, h4, [class*="title"],[data-qa-label*="title"]');
        
        // 🎯 ΕΙΔΙΚΗ ΛΟΓΙΚΗ ΓΙΑ ΑΒ (Ενώνει το Brand με το Όνομα Προϊόντος)
        if (storeName === 'ΑΒ Βασιλόπουλος') {
            const brandEl = card.querySelector('[data-testid="product-brand"]');
            const specificNameEl = card.querySelector('[data-testid="product-name"]');
            const brandText = brandEl ? brandEl.innerText.trim() : '';
            const nameText = specificNameEl ? specificNameEl.innerText.trim() : '';
            
            if (brandText || nameText) {
                name = `${brandText} ${nameText}`.trim();
            } else if (nameEl) {
                name = (nameEl.textContent || nameEl.innerText || '').trim();
            }
        } else if (storeName === 'MyMarket') {
            // Use GA data attribute name for clean product name
            const gaLink = card.querySelector('a[data-google-analytics-item-param]');
            if (gaLink) {
                try {
                    const gaData = JSON.parse(gaLink.getAttribute('data-google-analytics-item-param'));
                    if (gaData && gaData.name) name = gaData.name;
                } catch(e) {}
            }
            if (!name && nameEl) name = (nameEl.textContent || nameEl.innerText || '').trim();
        } else {
            if (nameEl) name = (nameEl.textContent || nameEl.innerText || '').trim();
        }

        // ── Τιμή: τελική τιμή συσκευασίας ──────────
        const isUnitPrice = (txt) => /\/\s*(τεμ|kg|lt|κιλ|λίτρ|100g|100ml)/i.test(txt) ||
                                      /ανά\s*(κιλό|λίτρο|τεμ|kg|lt)/i.test(txt) ||
                                      / τεμ\.\s*$/.test(txt.trim());

        if (storeName === 'MyMarket') {
            // Primary: GA data attribute — clean float, most reliable
            const gaLink = card.querySelector('a[data-google-analytics-item-param]');
            if (gaLink) {
                try {
                    const gaData = JSON.parse(gaLink.getAttribute('data-google-analytics-item-param'));
                    if (gaData && gaData.price) priceNum = parseFloat(gaData.price);
                } catch(e) {}
            }
            // Fallback: split whole + fraction (e.g. "1" + "29" → €1.29)
            if (!priceNum) {
                const wholeEl = card.querySelector('.teaser-display-price-whole');
                const fracEl  = card.querySelector('.teaser-display-price-fraction');
                if (wholeEl && fracEl) {
                    const whole = parseInt((wholeEl.textContent || '').trim(), 10) || 0;
                    const frac  = parseInt((fracEl.textContent  || '').trim(), 10) || 0;
                    const candidate = whole + frac / 100;
                    if (candidate > 0 && candidate < 999) priceNum = candidate;
                }
            }
            // Fallback 2: full .teaser-display-price text (space-split parser handles "€ 1 29")
            if (!priceNum) {
                const priceEl = card.querySelector('.teaser-display-price');
                if (priceEl) priceNum = parsePrice(priceEl.innerText || priceEl.textContent);
            }
        } else {
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
        
        // Special Masoutis price logic: .pDscntPrice = sale price, .pStartPrice = original
        if (storeName === 'Μασούτης') {
            const discEl = card.querySelector('.pDscntPrice');
            const startEl = card.querySelector('.pStartPrice');
            if (discEl) {
                priceNum = parsePrice(discEl.innerText || discEl.textContent);
                if (startEl) oldPriceNum = parsePrice(startEl.innerText || startEl.textContent);
                isSale = true;
            } else if (startEl) {
                priceNum = parsePrice(startEl.innerText || startEl.textContent);
                oldPriceNum = null;
            }
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
        
        // Εικόνα — try config.img selector, shadow-DOM pierce for Web Components, fallback to any img
        let imgEl = (config.img ? card.querySelector(config.img) : null) || card.querySelector('img');
        // Shadow DOM pierce (Galaxias uses <product-card> custom element)
        if (!imgEl && card.shadowRoot) {
            imgEl = (config.img ? card.shadowRoot.querySelector(config.img) : null) || card.shadowRoot.querySelector('img');
        }
        // Try shadow root of child custom elements
        if (!imgEl) {
            const customEls = card.querySelectorAll('*');
            for (const el of customEls) {
                if (el.shadowRoot) {
                    const found = el.shadowRoot.querySelector('img');
                    if (found) { imgEl = found; break; }
                }
            }
        }
        const extractSrc = (el) => {
            if (!el) return null;
            const src = el.getAttribute('src') || '';
            return (!src || src.startsWith('data:image/gif') || src.startsWith('data:') || src.length < 10
                ? (el.getAttribute('data-src') ||
                   el.getAttribute('data-lazy-src') ||
                   el.getAttribute('data-original') ||
                   el.getAttribute('data-lazy') ||
                   el.getAttribute('data-image') ||
                   (el.getAttribute('srcset') || '').split(',')[0].trim().split(' ')[0] ||
                   (el.getAttribute('data-srcset') || '').split(',')[0].trim().split(' ')[0] ||
                   src)
                : src) || null;
        };
        if (imgEl) {
            imgUrl = extractSrc(imgEl);
            // Final filter for invalid URLs
            if (imgUrl && imgUrl.length < 10) imgUrl = null;
            // Convert relative URLs to absolute using the page origin
            if (imgUrl && !imgUrl.startsWith('http') && !imgUrl.startsWith('//')) {
                imgUrl = imgUrl.startsWith('/')
                    ? window.location.origin + imgUrl
                    : window.location.origin + '/' + imgUrl;
            }
            if (imgUrl && imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        }

        // LIDL-specific: validity date + gift/discount text
        let validityDate = null;
        let discountPercent = null;
        if (storeName === 'Lidl') {
            const badgeEl = card.querySelector('.ods-badge__label');
            if (badgeEl) validityDate = (badgeEl.textContent || '').trim();
            const promoEl = card.querySelector('.ods-price__box-content-text-el');
            if (promoEl) {
                const pt = (promoEl.textContent || '').trim();
                if (pt) { discountPercent = pt; isSale = true; }
            }
        }

        // Αποθήκευση ΜΟΝΟ αν η τιμή είναι έγκυρη
        if (name && priceNum && priceNum > 0) {
            name = name.replace(/(το τεμάχιο|το τεμαχιο|συσκευασία|συσκευασια)/gi, '').trim();
            const normalizedName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            products.push({ name, normalizedName, supermarket: storeName, price: priceNum, oldPrice: oldPriceNum, isOnSale: isSale, is1plus1: is1plus1, imageUrl: imgUrl, validityDate, discountPercent });
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
/*
 * ΑΒ Βασιλόπουλος talks to its own GraphQL endpoint using Apollo persisted
 * queries: the client sends a sha256 hash instead of the query text, and the
 * server only honours hashes belonging to the frontend build it currently
 * serves. Every ΑΒ deploy therefore invalidates ours.
 *
 * Seeded with the hash observed on 2026-08-26 so a run works even if discovery
 * fails, and refreshed from the live page the moment the server rejects it.
 */
let abPersistedHash = 'd8bff3916275ffeb6f51604d36d7a3aa2f9cd92847487a7f2e3bdf6bb2115cdd';
let abHashRefreshed = false;

async function refreshAbHash(page) {
    if (abHashRefreshed) return false;   // one rotation per process is enough
    abHashRefreshed = true;
    try {
        const found = await page.evaluate(() => {
            const entry = performance.getEntriesByType('resource')
                .map((e) => decodeURIComponent(e.name))
                .find((n) => n.includes('operationName=GetCategoryProductSearch') && n.includes('sha256Hash'));
            return entry ? (entry.match(/"sha256Hash":"([a-f0-9]{64})"/) || [])[1] : null;
        });
        if (found && found !== abPersistedHash) { abPersistedHash = found; return true; }
    } catch (e) { /* discovery is best-effort; the caller falls back to Puppeteer */ }
    return false;
}

async function scrapeAB(page, storeName, config, allFound, categoryUrl) {
    // ΑΒ uses a GraphQL API — no browser scraping needed, call directly
    // API: GET https://www.ab.gr/api/v1/?operationName=GetCategoryProductSearch&variables=...
    // Requires Content-Type: application/json header to bypass CSRF check
    const axios = require('axios');
    const AB_IMG_BASE = 'https://static.ab.gr';

    // Extract category code from URL: /c/001 → "001"
    const categoryCode = (categoryUrl || '').match(/\/c\/(\w+)$/)?.[1];
    if (!categoryCode) {
        console.log(`⚠️ AB: could not extract category from ${categoryUrl}`);
        return;
    }

    const fetchPage = async (pageNum) => {
        const vars = encodeURIComponent(JSON.stringify({ lang: 'gr', searchQuery: '', category: categoryCode, pageNumber: pageNum, pageSize: 20, filterFlag: true, fields: 'PRODUCT_TILE', plainChildCategories: true }));
        const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: abPersistedHash } }));
        const url = `https://www.ab.gr/api/v1/?operationName=GetCategoryProductSearch&variables=${vars}&extensions=${ext}`;
        const { data } = await axios.get(url, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': categoryUrl },
            timeout: 15000,
        });
        /* A rejected persisted query comes back as HTTP 200 with an `errors`
           array, so axios does not throw and the old code read the empty body as
           "this category has no products". That is how ΑΒ went 27 days without a
           single save while every run reported success. Turn it into a throw so
           the caller either re-discovers the hash or falls through to Puppeteer. */
        if (data && data.errors && data.errors.length) {
            const err = new Error(data.errors[0].message || 'AB GraphQL error');
            err.abGraphQLCode = data.errors[0].extensions?.code || data.errors[0].reasonCode || '';
            throw err;
        }
        return data;
    };

    try {
        let first;
        try {
            first = await fetchPage(0);
        } catch (e) {
            /* ΑΒ ships a new frontend build every few weeks and each one gets a
               new persisted-query hash, which retires the old one server-side.
               The live page in front of us has already issued the very request
               we are imitating, so its hash is sitting in the resource timings —
               read it, then try once more. This is what stops a hash rotation
               from silently costing another month of data. */
            if (e.abGraphQLCode === 'PERSISTED_QUERY_NOT_FOUND' && await refreshAbHash(page)) {
                console.log(`  AB: persisted-query hash rotated, re-discovered ${abPersistedHash.slice(0, 12)}…`);
                first = await fetchPage(0);
            } else {
                throw e;
            }
        }
        const pagination = first?.data?.categoryProductSearch?.pagination || {};
        const totalPages = pagination.totalPages || 1;
        const totalResults = pagination.totalResults || 0;
        console.log(`  AB [${categoryCode}]: ${totalResults} products across ${totalPages} pages`);

        const processProducts = (products) => {
            (products || []).forEach(p => {
                try {
                    const name = (p.name || '').trim();
                    if (!name) return;
                    const priceNum = parseFloat(p.price?.value) || 0;
                    if (!priceNum) return;

                    const oldPriceNum = p.price?.wasPrice?.value ? parseFloat(p.price.wasPrice.value) : null;
                    const isSale = !!(p.price?.showStrikethroughPrice || oldPriceNum || (p.promoBadges && p.promoBadges.length > 0));

                    let imgUrl = null;
                    const rawImg = p.images?.[0]?.url || p.image || '';
                    if (rawImg) imgUrl = rawImg.startsWith('http') ? rawImg : AB_IMG_BASE + rawImg;

                    const normalizedName = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                    if (!allFound.has(normalizedName)) {
                        allFound.set(normalizedName, { name, normalizedName, supermarket: storeName, price: priceNum, oldPrice: oldPriceNum, isOnSale: isSale, is1plus1: false, imageUrl: imgUrl, discountPercent: null });
                    }
                } catch(e) {}
            });
        };

        processProducts(first?.data?.categoryProductSearch?.products);

        // Fetch remaining pages in parallel (max 3 at a time)
        for (let i = 1; i < totalPages; i += 3) {
            const batch = [];
            for (let j = i; j < Math.min(i + 3, totalPages); j++) batch.push(fetchPage(j));
            const results = await Promise.allSettled(batch);
            results.forEach(r => { if (r.status === 'fulfilled') processProducts(r.value?.data?.categoryProductSearch?.products); });
        }
    } catch(e) {
        console.log(`⚠️ AB API error for category ${categoryCode}: ${e.message}. Falling back to Puppeteer...`);
        // Fallback: try Puppeteer if API fails
        try { await page.waitForSelector(config.card, { timeout: 20000 }); } catch(e2) {}
        let fails2 = 0;
        while (fails2 < 8) {
            const prods = await page.evaluate(extractDataInBrowser, storeName, config);
            let addedNew = false;
            prods.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; } });
            if (addedNew) fails2 = 0; else fails2++;
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
            await sleep(1500);
        }
    }
}
async function scrapeGalaxias(page, storeName, config, allFound) {
    // Wait for product cards to appear before starting scroll loop
    try { await page.waitForSelector(config.card, { timeout: 20000 }); } catch(e) {}
    await sleep(1500);

    let fails = 0;
    while (fails < 15) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }

        /* Galaxias renders inside an Angular Material sidenav, so the document
           itself never scrolls — document.scrollingElement stays one viewport
           tall no matter what. Keyboard PageDown and window.scrollBy therefore
           moved nothing, the infinite scroll never fired, and only the first
           page of each category was ever collected. Measured 2026-08-30:
           /eshop/86 went 32 -> 126 products and /eshop/89 went 32 -> 256 the
           moment the real scroll container was driven instead.

           The old code also tried a load-more button first; that selector
           matches zero elements on this site (verified), so the branch was
           dead and is gone. */
        const scrolled = await page.evaluate(() => {
            const scroller = document.querySelector('mat-sidenav-content')
                || [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 80 && e.clientHeight > 300)
                || document.scrollingElement;
            const before = scroller.scrollTop;
            scroller.scrollTop = scroller.scrollHeight;
            return scroller.scrollTop !== before;
        });
        /* Longer settle when the container actually moved: that is when a new
           batch is being fetched and rendered. */
        await sleep(scrolled ? 1400 : 700);
    }
}
async function scrapeMyMarket(page, storeName, config, allFound) {
    // MyMarket is a Next.js/React app — wait for hydration before extracting
    try {
        await page.waitForSelector(config.card, { timeout: 20000 });
    } catch(e) {
        // If card selector times out, try scrolling to trigger render
        for (let i = 0; i < 5; i++) { await page.keyboard.press('PageDown'); await sleep(400); }
    }
    await sleep(1500); // extra wait for price elements to render

    let keepGoing = true; let fails = 0;
    while (keepGoing && fails < 10) {
        // Scroll to trigger lazy-rendering of remaining products
        for (let i = 0; i < 10; i++) { await page.keyboard.press('PageDown'); await sleep(80); }
        await sleep(600);

        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; } });
        if (addedNew) fails = 0; else fails++;

        const hasNext = await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn && !btn.disabled && btn.offsetParent !== null) { btn.click(); return true; }
            return false;
        }, config.nextBtn);
        if (hasNext) { await sleep(3000); fails = 0; }
        else if (!addedNew) { fails++; if (fails >= 3) keepGoing = false; }
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
    // Wait for any product card to appear first
    try { await page.waitForSelector(config.card, { timeout: 20000 }); } catch(e) {}
    await sleep(1000);

    let fails = 0;
    while (fails < 20) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        if (addedNew) { fails = 0; } else { fails++; }

        // Scroll down multiple steps to trigger infinite scroll
        for (let i = 0; i < 3; i++) { await page.keyboard.press('PageDown'); await sleep(150); }

        // Wait for spinner loader to finish if it appeared
        const isLoading = await page.evaluate((sel) => {
            const loader = document.querySelector(sel);
            return loader && loader.style.display !== 'none';
        }, config.loader);
        await sleep(isLoading ? 2000 : 400);
    }
}
async function scrapeKritikos(page, storeName, config, allFound) {
    let fails = 0;
    
    // ΠΕΡΙΜΕΝΟΥΜΕ ΝΑ ΦΥΓΕΙ ΤΟ ΛΕΥΚΟ ΠΛΑΙΣΙΟ (Hydration delay)
    try { 
        await page.waitForSelector(config.card, { timeout: 15000 }); 
    } catch (e) { 
        console.log(`\n⏳ Timeout αναμονής προϊόντων στον Κρητικό.`); 
    }

    while (fails < 15) {
        const products = await page.evaluate(extractDataInBrowser, storeName, config);
        let addedNew = false;
        products.forEach(p => { if (!allFound.has(p.normalizedName)) { allFound.set(p.normalizedName, p); addedNew = true; }});
        
        if (addedNew) { fails = 0; } else { fails++; }
        
        // Κάνουμε πιο ομαλό scroll για τον Κρητικό
        for (let i = 0; i < 6; i++) { 
            await page.keyboard.press('PageDown'); 
            await sleep(150); 
        }
        await sleep(600);
    }
}

async function scrapeLidl(page, storeName, config, allFound) {
    // LIDL: data-grid-data JSON attr on .odsc-tile divs (server-rendered, present before skeleton hydration)
    // Image: data.imageList[0] || data.image || data.cutoutimageV2 || data.image_V1
    try { await page.waitForSelector('.odsc-tile[data-grid-data]', { timeout: 25000 }); } catch(e) {}

    const MAX_CLICKS = 60;
    let safetyLimit = 0;

    while (safetyLimit < MAX_CLICKS) {
        const products = await page.evaluate((storeNameArg) => {
            const result = [];
            const seen = new Set();

            document.querySelectorAll('.odsc-tile[data-grid-data]').forEach(tile => {
                try {
                    const d = JSON.parse(tile.getAttribute('data-grid-data'));

                    const title = d.fullTitle || d.title || '';
                    if (!title) return;

                    const priceObj = d.price || {};
                    const priceNum = parseFloat(priceObj.price) || 0;
                    if (!priceNum || priceNum <= 0) return;

                    if (seen.has(title)) return;
                    seen.add(title);

                    // Old price
                    const oldPriceNum = (priceObj.oldPrice && priceObj.oldPrice > 0) ? priceObj.oldPrice : null;
                    let isSale = priceObj.priceTheme === 'white_red' || !!oldPriceNum;
                    let is1plus1 = false, discountPercent = null;

                    (d.ribbons || []).forEach(r => {
                        const txt = (r.text || r.label || JSON.stringify(r)).toLowerCase();
                        if (txt.includes('1+1') || txt.includes('+1')) { is1plus1 = true; isSale = true; }
                        const m = txt.match(/(-?\d+)\s*%/);
                        if (m) { discountPercent = m[0]; isSale = true; }
                    });

                    // Image: try known paths in order
                    let imgUrl = null;
                    const imgCandidates = [
                        d.imageList && d.imageList[0],
                        d.imageList_V1 && d.imageList_V1[0],
                        d.image,
                        d.image_V1,
                        d.cutoutimageV2
                    ];
                    for (const c of imgCandidates) {
                        if (c && typeof c === 'string' && c.length > 5) { imgUrl = c; break; }
                        if (c && typeof c === 'object') {
                            const u = c.url || c.src || c.href || Object.values(c).find(v => typeof v === 'string' && v.startsWith('http'));
                            if (u) { imgUrl = u; break; }
                        }
                    }
                    if (imgUrl && imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;

                    const name = title.replace(/(το τεμάχιο|το τεμαχιο|συσκευασία|συσκευασια)/gi, '').trim();
                    const normalizedName = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                    result.push({ name, normalizedName, supermarket: storeNameArg, price: priceNum, oldPrice: oldPriceNum, isOnSale: isSale, is1plus1, imageUrl: imgUrl, discountPercent });
                } catch(e) {}
            });
            return result;
        }, storeName);

        products.forEach(p => { if (!allFound.has(p.normalizedName)) allFound.set(p.normalizedName, p); });

        // Progress counter
        const { loaded, total, hasButton } = await page.evaluate((loadMoreSel) => {
            const counterEl = document.querySelector('.s-load-more__text');
            let loaded = 0, total = 0;
            if (counterEl) {
                const m = counterEl.textContent.match(/(\d+)\s*[/|]\s*(\d+)/);
                if (m) { loaded = parseInt(m[1]); total = parseInt(m[2]); }
            }
            const btn = document.querySelector(loadMoreSel);
            return { loaded, total, hasButton: !!btn && !btn.disabled && btn.offsetParent !== null };
        }, config.loadMore);

        console.log('  LIDL: ' + loaded + '/' + total + ' loaded (' + allFound.size + ' unique)');

        if (!hasButton || (total > 0 && loaded >= total)) break;

        await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) { btn.scrollIntoView({ block: 'center' }); btn.click(); }
        }, config.loadMore);

        await sleep(2500);
        safetyLimit++;
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
                case 'ΑΒ Βασιλόπουλος': await scrapeAB(page, storeName, config, allFound, url); break;
                case 'Γαλαξίας': await scrapeGalaxias(page, storeName, config, allFound); break;
                case 'MyMarket': await scrapeMyMarket(page, storeName, config, allFound); break;
                case 'Market In': await scrapeMarketIn(page, storeName, config, allFound); break;
                case 'Μασούτης': await scrapeMasoutis(page, storeName, config, allFound); break;
                case 'Κρητικός': await scrapeKritikos(page, storeName, config, allFound); break;
                case 'Lidl':     await scrapeLidl(page, storeName, config, allFound); break;
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
    console.log(`\n📦 [${storeName}] Βρέθηκαν ${finalProducts.length} προϊόντα → αποθήκευση...`);

    savedPerStore.set(storeName, (savedPerStore.get(storeName) || 0) + finalProducts.length);

    if (finalProducts.length > 0) {
        const now = new Date();
        const bulkOps = finalProducts.map(product => ({
            updateOne: {
                filter: { normalizedName: product.normalizedName, supermarket: product.supermarket },
                update: { $set: { ...product, dateScraped: now } },
                upsert: true
            }
        }));
        const result = await Product.bulkWrite(bulkOps);
        console.log(`✅ [${storeName}] upserted=${result.upsertedCount} modified=${result.modifiedCount}`);

        // 📈 Record a daily price-history snapshot (one point per product/store/day).
        // Best-effort: never let history bookkeeping break a successful scrape.
        try {
            const PriceHistory = require('../models/PriceHistory');
            const day = now.toISOString().slice(0, 10);
            const histOps = finalProducts
                .filter(p => p.price > 0)
                .map(p => ({
                    updateOne: {
                        filter: { normalizedName: p.normalizedName, supermarket: p.supermarket, day },
                        update: {
                            $set: { price: p.price, date: now },
                            $setOnInsert: { normalizedName: p.normalizedName, supermarket: p.supermarket, day },
                        },
                        upsert: true,
                    },
                }));
            if (histOps.length) {
                await PriceHistory.bulkWrite(histOps, { ordered: false });
                console.log(`📈 [${storeName}] price-history points: ${histOps.length}`);
            }
        } catch (e) {
            console.warn(`[PriceHistory] skip (${storeName}): ${e.message}`);
        }
    } else {
        console.log(`⚠️  [${storeName}] 0 προϊόντα βρέθηκαν — τίποτα δεν αποθηκεύτηκε`);
    }

    // 🟢 Ενημέρωση Progress Bar
    completedJobs++;
    drawProgressBar(completedJobs, totalJobs, storeName);
}

// --- ORCHESTRATOR ---
/* Per-run tally of what each chain actually saved. A chain that saves nothing
   is not a quiet edge case — it means the site changed under us and the app is
   now serving that chain's prices from however long ago it last worked. The
   runner reads this and fails the job, so it shows up as a red run instead of
   as a green one hiding a month-old shelf. */
const savedPerStore = new Map();

async function runWebScraper(targetStore = null) {
    savedPerStore.clear();
    console.log(`\n🥷 ENTERPRISE STEALTH CLUSTER INITIATED.`);
    globalIsScraping = true; // Ξεκίνησε!
    completedJobs = 0;

    let urlsToScrape = [ ...SKLAVENITIS_URLS, ...MYMARKET_URLS, ...MASOUTIS_URLS, ...KRITIKOS_URLS, ...GALAXIAS_URLS, ...MARKET_IN_URLS, ...LIDL_URLS, ...AB_URLS ];

    // AB URLs are hardcoded in AB_URLS constant — no category_links.json needed

    let storeMap = urlsToScrape.map(url => {
        if (url.includes('ab.gr')) return { storeName: 'ΑΒ Βασιλόπουλος', url, id: 'ab' };
        if (url.includes('sklavenitis.gr')) return { storeName: 'Σκλαβενίτης', url, id: 'sklavenitis' };
        if (url.includes('mymarket.gr')) return { storeName: 'MyMarket', url, id: 'mymarket' };
        if (url.includes('masoutis.gr')) return { storeName: 'Μασούτης', url, id: 'masoutis' };
        if (url.includes('kritikos-sm.gr')) return { storeName: 'Κρητικός', url, id: 'kritikos' };
        if (url.includes('galaxias.shop')) return { storeName: 'Γαλαξίας', url, id: 'galaxias' };
        if (url.includes('market-in.gr')) return { storeName: 'Market In', url, id: 'marketin' };
        if (url.includes('lidl-hellas.gr')) return { storeName: 'Lidl', url, id: 'lidl' };
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

    // Resolve Chrome executable: prefer system Chrome so no separate Puppeteer download is needed
    const SYSTEM_CHROME_PATHS = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
    ];
    let executablePath;
    // Explicit override wins (CI sets PUPPETEER_EXECUTABLE_PATH to a verified Chrome
    // binary — avoids the GH Actions "folder exists but executable missing" cache bug).
    const envChrome = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envChrome && fs.existsSync(envChrome)) {
        executablePath = envChrome;
    } else {
        for (const p of SYSTEM_CHROME_PATHS) {
            if (fs.existsSync(p)) { executablePath = p; break; }
        }
    }

    // ── Cluster profile ────────────────────────────────────────────────────
    // Render free tier : maxConcurrency=3, CONCURRENCY_BROWSER, --single-process
    // Local high-perf   : maxConcurrency=8, CONCURRENCY_CONTEXT (set via env)
    const maxConcurrency = parseInt(process.env.SCRAPER_MAX_CONCURRENCY || '3', 10);
    const concurrencyMode = process.env.SCRAPER_CONCURRENCY_MODE === 'context'
        ? Cluster.CONCURRENCY_CONTEXT
        : Cluster.CONCURRENCY_BROWSER;
    const isLocal   = process.env.SCRAPER_PROFILE === 'local';
    const isGithub  = process.env.SCRAPER_PROFILE === 'github';  // GH Actions: lots of RAM, no --single-process
    const oldSpaceSize = isLocal ? '2048' : (isGithub ? '3072' : '512');

    const profileLabel = isLocal ? 'LOCAL' : isGithub ? 'GITHUB-ACTIONS' : 'RENDER';
    console.log(`🔧 Scraper profile: ${profileLabel} | concurrency=${maxConcurrency} | mode=BROWSER`);

    // Render free tier: 512MB RAM. Each Chrome instance ~150-200MB.
    // maxConcurrency=3 → ~450-600MB peak, safe for free tier.
    // CONCURRENCY_BROWSER: one browser per slot (isolated, lower memory than CONTEXT)
    const clusterArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        `--js-flags=--max-old-space-size=${oldSpaceSize}`,
        '--disable-notifications',
        '--no-default-browser-check',
    ];
    // --single-process saves ~50MB on Render's 512MB plan but disables crash recovery
    // and causes "Session closed" errors on heavy sites (Sklavenitis, ΑΒ).
    // GitHub Actions has 7GB RAM — never use single-process there.
    if (!isLocal && !isGithub) clusterArgs.push('--single-process', '--memory-pressure-off');

    const cluster = await Cluster.launch({
        concurrency: concurrencyMode,
        maxConcurrency,
        timeout: 600000,
        puppeteerOptions: {
            headless: isLocal ? false : "new",
            defaultViewport: { width: 1280, height: 800 },
            ...(executablePath ? { executablePath } : {}),
            args: clusterArgs,
        }
    });

    cluster.on('taskerror', (err, data) => {
        console.error(`❌ Task error [${data?.storeName || data?.url}]: ${err?.message || err}`);
    });

    await cluster.task(scrapeTask);
    storeMap.forEach(data => cluster.queue(data));
    
    await cluster.idle();
    await cluster.close();

    globalIsScraping = false; // Τελείωσε!
    console.log(`\n🎉 ΤΕΛΟΣ: Η Stealth Engine ολοκλήρωσε επιτυχώς όλες τις εργασίες.`);
}

// 🟢 Το API για να βλέπει το Frontend αν τρέχει το Scraper
const getScrapingStatus = () => { return globalIsScraping; };

const startCronJobs = () => { cron.schedule('20 8 * * *', runWebScraper); };
module.exports = { startCronJobs, runWebScraper, getScrapingStatus, savedPerStore };