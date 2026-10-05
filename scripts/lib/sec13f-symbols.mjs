import fs from "node:fs";
import path from "node:path";

export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

// Exact primary-source security identities. October 4/5 additions and same-class
// CUSIP/ticker source pairs are recorded in the platform's data-recovery receipt.
// Trust shares (SLV) retain their security identity; this map assigns no sector.
const AUTHORITATIVE_CUSIP_SYMBOLS = new Map([
  // SEC Alphabet 13G covers identify these classes; the June 2026 10-Q
  // identifies Class A as GOOGL and Class C as GOOG.
  ["02079K305", { symbol: "GOOGL", source: "sec-alphabet-13g-2025-10q-2026-class-a" }],
  ["02079K107", { symbol: "GOOG", source: "sec-alphabet-13g-2021-10q-2026-class-c" }],
  ["023135106", { symbol: "AMZN", source: "sec-amazon-13g-2026-common" }],
  ["580135101", { symbol: "MCD", source: "sec-mcdonalds-13g-2026-common" }],
  ["04626A103", { symbol: "ALAB", source: "sec-astera-labs-13g-2026-common" }],
  ["530909100", { symbol: "LLYVA", source: "sec-liberty-live-2025-annual-report" }],
  ["530909308", { symbol: "LLYVK", source: "sec-liberty-live-2025-annual-report" }],
  ["025537101", { symbol: "AEP", source: "issuer-aep-2025-cdp-security-identifiers" }],
  ["064058100", { symbol: "BNY", source: "sec-nport-2026-bny-common" }],
  ["12504L109", { symbol: "CBRE", source: "sec-nport-2026-cbre-class-a" }],
  ["219350105", { symbol: "GLW", source: "sec-nport-2026-corning-common" }],
  ["46428Q109", { symbol: "SLV", source: "issuer-ishares-2026-silver-trust" }],
  ["49177J102", { symbol: "KVUE", source: "sec-kenvue-13g-2025-10q-2026-common" }],
  ["56585A102", { symbol: "MPC", source: "sec-marathon-13g-2025-10k-2026-common" }],
  ["693475105", { symbol: "PNC", source: "issuer-pnc-common-stock-faq" }],
  ["74762E102", { symbol: "PWR", source: "sec-nport-2026-quanta-common" }],
  ["77543R102", { symbol: "ROKU", source: "sec-roku-13g-2026-10k-2026-class-a" }],
  ["780087102", { symbol: "RY", source: "sec-nport-2026-rbc-common" }],
  ["872540109", { symbol: "TJX", source: "issuer-tjx-13g-2025-8k-2026-common" }],
  ["00187Y100", { symbol: "APG", source: "sec-issuer-2026-apg-common" }],
  ["030420103", { symbol: "AWK", source: "sec-issuer-2026-awk-common" }],
  ["03076C106", { symbol: "AMP", source: "sec-issuer-2026-amp-common" }],
  ["03820C105", { symbol: "AIT", source: "sec-issuer-2026-ait-common" }],
  ["063671101", { symbol: "BMO", source: "sec-issuer-2026-bmo-common-shares" }],
  ["143130102", { symbol: "KMX", source: "sec-issuer-2026-kmx-common" }],
  ["15675D103", { symbol: "CBRS", source: "sec-issuer-2026-cbrs-class-a-common" }],
  ["25459W458", { symbol: "SOXL", source: "sec-issuer-2026-soxl-etf-shares" }],
  ["25459Y165", { symbol: "SPUU", source: "sec-issuer-2026-spuu-etf-shares" }],
  ["291011104", { symbol: "EMR", source: "sec-issuer-2026-emr-common" }],
  ["33939L100", { symbol: "TILT", source: "sec-issuer-2026-tilt-etf-shares" }],
  ["33939L407", { symbol: "GUNR", source: "sec-issuer-2026-gunr-etf-shares" }],
  ["33939L506", { symbol: "TDTT", source: "sec-issuer-2026-tdtt-etf-shares" }],
  ["33939L795", { symbol: "NFRA", source: "sec-issuer-2026-nfra-etf-shares" }],
  ["33939L860", { symbol: "QDF", source: "sec-issuer-2026-qdf-etf-shares" }],
  ["33939L886", { symbol: "RAVI", source: "sec-issuer-2026-ravi-etf-shares" }],
  ["34631F102", { symbol: "FPS", source: "sec-issuer-2026-fps-class-a-common" }],
  ["45104G104", { symbol: "IBN", source: "sec-issuer-2026-ibn-adr" }],
  ["452308109", { symbol: "ITW", source: "sec-issuer-2026-itw-common" }],
  ["45866F104", { symbol: "ICE", source: "sec-issuer-2026-ice-common" }],
  ["464288737", { symbol: "KXI", source: "sec-issuer-2026-kxi-etf-shares" }],
  ["464289180", { symbol: "EUFN", source: "sec-issuer-2026-eufn-etf-shares" }],
  ["565394103", { symbol: "CART", source: "sec-issuer-2026-cart-common" }],
  ["571748102", { symbol: "MRSH", source: "sec-issuer-2026-mrsh-common" }],
  ["58507V107", { symbol: "MDLN", source: "sec-issuer-2026-mdln-class-a-common" }],
  ["606822104", { symbol: "MUFG", source: "sec-issuer-2026-mufg-adr" }],
  ["695156109", { symbol: "PKG", source: "sec-issuer-2026-pkg-common" }],
  ["744573106", { symbol: "PEG", source: "sec-issuer-2026-peg-common" }],
  ["780287108", { symbol: "RGLD", source: "sec-issuer-2026-rgld-common" }],
  ["866966104", { symbol: "SUNB", source: "sec-issuer-2026-sunb-common" }],
  ["87612G101", { symbol: "TRGP", source: "sec-issuer-2026-trgp-common" }],
  ["88023B103", { symbol: "TEM", source: "sec-issuer-2026-tem-class-a-common" }],
  ["88635A105", { symbol: "PBEU", source: "sec-issuer-2026-pbeu-etf-shares" }],
  ["88635A204", { symbol: "PBPH", source: "sec-issuer-2026-pbph-etf-shares" }],
  ["88635A303", { symbol: "PBOG", source: "sec-issuer-2026-pbog-etf-shares" }],
  ["911312106", { symbol: "UPS", source: "sec-issuer-2026-ups-class-b-common" }],
  ["912008109", { symbol: "USFD", source: "sec-issuer-2026-usfd-common" }],
  ["94106L109", { symbol: "WM", source: "sec-issuer-2026-wm-common" }],
  ["G4705A100", { symbol: "ICLR", source: "sec-issuer-2026-iclr-ordinary-shares" }],
  ["G6700G107", { symbol: "NVT", source: "sec-issuer-2026-nvt-ordinary-shares" }],
  ["42824C109", { symbol: "HPE", source: "issuer-hpe-common-stock-identifiers" }],
  ["H25662182", { symbol: "CFRHF", source: "sec-nport-2026-richemont-ordinary-shares" }],
  ["00508Y102", { symbol: "AYI", source: "sec-13g-2026-acuity-issuer-current-common" }],
  // SPDR fund CUSIP (prospectus key) and ticker from State Street's fund-finder data.
  ["78464A698", { symbol: "KRE", source: "issuer-ssga-2026-kre-etf-shares" }],
  ["78464A755", { symbol: "XME", source: "issuer-ssga-2026-xme-etf-shares" }],
  ["78464A797", { symbol: "KBE", source: "issuer-ssga-2026-kbe-etf-shares" }],
  ["78464A870", { symbol: "XBI", source: "issuer-ssga-2026-xbi-etf-shares" }],
  ["78468R556", { symbol: "XOP", source: "issuer-ssga-2026-xop-etf-shares" }],
  ["78468R663", { symbol: "BIL", source: "issuer-ssga-2026-bil-etf-shares" }],
  ["81369Y209", { symbol: "XLV", source: "issuer-ssga-2026-xlv-etf-shares" }],
  ["81369Y308", { symbol: "XLP", source: "issuer-ssga-2026-xlp-etf-shares" }],
  ["81369Y407", { symbol: "XLY", source: "issuer-ssga-2026-xly-etf-shares" }],
  ["81369Y506", { symbol: "XLE", source: "issuer-ssga-2026-xle-etf-shares" }],
  ["81369Y605", { symbol: "XLF", source: "issuer-ssga-2026-xlf-etf-shares" }],
  ["81369Y704", { symbol: "XLI", source: "issuer-ssga-2026-xli-etf-shares" }],
  ["81369Y803", { symbol: "XLK", source: "issuer-ssga-2026-xlk-etf-shares" }],
  ["81369Y886", { symbol: "XLU", source: "issuer-ssga-2026-xlu-etf-shares" }],
  // Independently verified issuer fund pages and structured SEC cover fields.
  // Current SEC CIK/ticker binding was refreshed on October 5; no name inference.
  ["922908363", { symbol: "VOO", source: "issuer-vanguard-2026-voo-etf-shares" }],
  ["922908769", { symbol: "VTI", source: "issuer-vanguard-2026-vti-etf-shares" }],
  ["922042858", { symbol: "VWO", source: "issuer-vanguard-2026-vwo-etf-shares" }],
  ["921943858", { symbol: "VEA", source: "issuer-vanguard-2026-vea-etf-shares" }],
  ["92206C870", { symbol: "VCIT", source: "issuer-vanguard-2026-vcit-etf-shares" }],
  ["922908736", { symbol: "VUG", source: "issuer-vanguard-2026-vug-etf-shares" }],
  ["922908744", { symbol: "VTV", source: "issuer-vanguard-2026-vtv-etf-shares" }],
  ["922042775", { symbol: "VEU", source: "issuer-vanguard-2026-veu-etf-shares" }],
  ["922907746", { symbol: "VTEB", source: "issuer-vanguard-2026-vteb-etf-shares" }],
  ["74347X831", { symbol: "TQQQ", source: "issuer-proshares-2026-tqqq-etf-shares" }],
  ["G491BT108", { symbol: "IVZ", source: "sec-13g-2026-ivz-common" }],
  ["02376R102", { symbol: "AAL", source: "sec-13g-2026-aal-common" }],
  ["37045V100", { symbol: "GM", source: "sec-13g-2026-gm-common" }],
  ["78409V104", { symbol: "SPGI", source: "sec-13g-2026-spgi-common" }],
  ["91307C102", { symbol: "UTHR", source: "sec-13g-2026-uthr-common" }],
  ["902973304", { symbol: "USB", source: "sec-13g-2026-usb-common" }],
  ["736508847", { symbol: "POR", source: "sec-13g-2026-por-common" }],
  // iShares fund CUSIP and exchange ticker from the issuer's product screener data.
  ["464286400", { symbol: "EWZ", source: "issuer-ishares-2026-ewz-etf-shares" }],
  ["464286509", { symbol: "EWC", source: "issuer-ishares-2026-ewc-etf-shares" }],
  ["464287150", { symbol: "ITOT", source: "issuer-ishares-2026-itot-etf-shares" }],
  ["464287184", { symbol: "FXI", source: "issuer-ishares-2026-fxi-etf-shares" }],
  ["464287200", { symbol: "IVV", source: "issuer-ishares-2026-ivv-etf-shares" }],
  ["464287226", { symbol: "AGG", source: "issuer-ishares-2026-agg-etf-shares" }],
  ["464287234", { symbol: "EEM", source: "issuer-ishares-2026-eem-etf-shares" }],
  ["464287242", { symbol: "LQD", source: "issuer-ishares-2026-lqd-etf-shares" }],
  ["464287432", { symbol: "TLT", source: "issuer-ishares-2026-tlt-etf-shares" }],
  ["464287440", { symbol: "IEF", source: "issuer-ishares-2026-ief-etf-shares" }],
  ["464287465", { symbol: "EFA", source: "issuer-ishares-2026-efa-etf-shares" }],
  ["464287499", { symbol: "IWR", source: "issuer-ishares-2026-iwr-etf-shares" }],
  ["464287507", { symbol: "IJH", source: "issuer-ishares-2026-ijh-etf-shares" }],
  ["464287515", { symbol: "IGV", source: "issuer-ishares-2026-igv-etf-shares" }],
  ["464287523", { symbol: "SOXX", source: "issuer-ishares-2026-soxx-etf-shares" }],
  ["464287556", { symbol: "IBB", source: "issuer-ishares-2026-ibb-etf-shares" }],
  ["464287598", { symbol: "IWD", source: "issuer-ishares-2026-iwd-etf-shares" }],
  ["464287614", { symbol: "IWF", source: "issuer-ishares-2026-iwf-etf-shares" }],
  ["464287622", { symbol: "IWB", source: "issuer-ishares-2026-iwb-etf-shares" }],
  ["464287655", { symbol: "IWM", source: "issuer-ishares-2026-iwm-etf-shares" }],
  ["464287663", { symbol: "IUSV", source: "issuer-ishares-2026-iusv-etf-shares" }],
  ["464287671", { symbol: "IUSG", source: "issuer-ishares-2026-iusg-etf-shares" }],
  ["464287689", { symbol: "IWV", source: "issuer-ishares-2026-iwv-etf-shares" }],
  ["464287804", { symbol: "IJR", source: "issuer-ishares-2026-ijr-etf-shares" }],
  ["464288257", { symbol: "ACWI", source: "issuer-ishares-2026-acwi-etf-shares" }],
  ["464288372", { symbol: "IGF", source: "issuer-ishares-2026-igf-etf-shares" }],
  ["464288414", { symbol: "MUB", source: "issuer-ishares-2026-mub-etf-shares" }],
  ["464288588", { symbol: "MBB", source: "issuer-ishares-2026-mbb-etf-shares" }],
  ["464288646", { symbol: "IGSB", source: "issuer-ishares-2026-igsb-etf-shares" }],
  ["464288729", { symbol: "EXI", source: "issuer-ishares-2026-exi-etf-shares" }],
  ["464288810", { symbol: "IHI", source: "issuer-ishares-2026-ihi-etf-shares" }],
  ["46432F339", { symbol: "QUAL", source: "issuer-ishares-2026-qual-etf-shares" }],
  ["46432F834", { symbol: "IXUS", source: "issuer-ishares-2026-ixus-etf-shares" }],
  ["46432F842", { symbol: "IEFA", source: "issuer-ishares-2026-iefa-etf-shares" }],
  ["46434G103", { symbol: "IEMG", source: "issuer-ishares-2026-iemg-etf-shares" }],
  ["46434G764", { symbol: "EMXC", source: "issuer-ishares-2026-emxc-etf-shares" }],
  ["46435U853", { symbol: "USHY", source: "issuer-ishares-2026-ushy-etf-shares" }],
  ["46436E718", { symbol: "SGOV", source: "issuer-ishares-2026-sgov-etf-shares" }],
  // SEC Schedule 13G cover CUSIP of the subject's common stock, ticker from SEC company_tickers by CIK.
  ["718172109", { symbol: "PM", source: "sec-13g-2024-pm-common" }],
  ["459200101", { symbol: "IBM", source: "sec-13g-2024-ibm-common" }],
  ["655844108", { symbol: "NSC", source: "sec-13g-2024-nsc-common" }],
  ["026874784", { symbol: "AIG", source: "sec-13g-2024-aig-common" }],
  ["609207105", { symbol: "MDLZ", source: "sec-13g-2024-mdlz-common" }],
  ["910047109", { symbol: "UAL", source: "sec-13g-2025-ual-common" }],
  ["G87110105", { symbol: "FTI", source: "sec-13g-2024-fti-ordinary" }],
  ["907818108", { symbol: "UNP", source: "sec-13g-2026-unp-common" }],
  ["053015103", { symbol: "ADP", source: "sec-13g-2026-adp-common" }],
  ["06849F108", { symbol: "B", source: "sec-13g-2026-barrick-common" }],
  ["136385101", { symbol: "CNQ", source: "sec-13g-2026-cnq-common" }],
  ["D18190898", { symbol: "DB", source: "sec-13g-2025-db-ordinary" }],
  ["136375102", { symbol: "CNI", source: "sec-13d-2024-cni-common" }],
  ["758750103", { symbol: "RRX", source: "sec-13g-2026-rrx-common" }],
  ["009158106", { symbol: "APD", source: "sec-13g-2026-apd-common" }],
  ["828806109", { symbol: "SPG", source: "sec-13g-2026-spg-common" }],
  ["571903202", { symbol: "MAR", source: "sec-13g-2026-mar-class-a-common" }],
  ["929740108", { symbol: "WAB", source: "sec-13g-2026-wab-common" }],
  ["12769G100", { symbol: "CZR", source: "sec-13g-2026-czr-common" }],
  ["228368106", { symbol: "CCK", source: "sec-13g-2026-cck-common" }],
  ["281020107", { symbol: "EIX", source: "sec-13g-2026-eix-common" }],
  ["31620M106", { symbol: "FIS", source: "sec-13g-2026-fis-common" }],
  ["857477103", { symbol: "STT", source: "sec-13g-2026-stt-common" }],
  ["398182303", { symbol: "AHR", source: "sec-13g-2026-ahr-common" }],
  ["55825T103", { symbol: "MSGS", source: "sec-13g-2026-msgs-class-a-common" }],
  ["45168D104", { symbol: "IDXX", source: "sec-13g-2026-idxx-common" }],
  ["77311W101", { symbol: "RKT", source: "sec-13g-2026-rkt-common" }],
  ["526107107", { symbol: "LII", source: "sec-13g-2026-lii-common" }],
  ["136069101", { symbol: "CM", source: "sec-13g-2026-cm-common" }],
  ["051774107", { symbol: "AUR", source: "sec-13g-2026-aur-common" }],
  ["72348N109", { symbol: "PNFP", source: "sec-13g-2026-pnfp-common" }],
  ["171484108", { symbol: "CHDN", source: "sec-13g-2026-chdn-common" }],
  ["302130109", { symbol: "EXPD", source: "sec-13g-2026-expd-common" }],
  ["741623102", { symbol: "PRMB", source: "sec-13g-2026-prmb-common" }],
  ["649445400", { symbol: "FLG", source: "sec-13g-2026-flg-common" }],
  ["538034109", { symbol: "LYV", source: "sec-13g-2026-lyv-common" }],
  ["679580100", { symbol: "ODFL", source: "sec-13g-2026-odfl-common" }],
  ["09228F103", { symbol: "BB", source: "sec-13g-2026-bb-common" }],
  ["44916Y106", { symbol: "PURR", source: "sec-13g-2026-purr-common" }],
  ["00650F109", { symbol: "ADPT", source: "sec-13g-2026-adpt-common" }],
  ["42806J700", { symbol: "HTZ", source: "sec-13g-2026-htz-common" }],
  ["812215200", { symbol: "SEG", source: "sec-13g-2025-seg-common" }],
  ["31620R303", { symbol: "FNF", source: "sec-13g-2026-fnf-common" }],
  ["608190104", { symbol: "MHK", source: "sec-13g-2026-mhk-common" }],
  ["749685103", { symbol: "RPM", source: "sec-13g-2026-rpm-common" }],
  ["558256103", { symbol: "MSGE", source: "sec-13g-2026-msge-common" }],
  ["302520101", { symbol: "FNB", source: "sec-13g-2026-fnb-common" }],
  ["913903100", { symbol: "UHS", source: "sec-13g-2026-uhs-common" }],
  ["007973100", { symbol: "AEIS", source: "sec-13g-2026-aeis-common" }],
  ["07782B104", { symbol: "BLTE", source: "sec-13g-2026-blte-common" }],
  ["67080N101", { symbol: "NUVB", source: "sec-13g-2025-nuvb-common" }],
  ["91823B109", { symbol: "UWMC", source: "sec-13g-2026-uwmc-common" }],
  ["74144T108", { symbol: "TROW", source: "sec-13g-2026-trow-common" }],
  ["032095101", { symbol: "APH", source: "sec-13g-2026-aph-common" }],
  ["N20944109", { symbol: "CNH", source: "sec-13g-2026-cnh-common" }],
  ["426281101", { symbol: "JKHY", source: "sec-13g-2026-jkhy-common" }],
  ["042735100", { symbol: "ARW", source: "sec-13g-2026-arw-common" }],
  ["M5216V106", { symbol: "GLBE", source: "sec-13g-2026-glbe-common" }],
  ["G9572D103", { symbol: "BULL", source: "sec-13g-2026-bull-common" }],
  ["85208M102", { symbol: "SFM", source: "sec-13g-2026-sfm-common" }],
  ["83443Q103", { symbol: "SOLS", source: "sec-13g-2026-sols-common" }],
  ["778920306", { symbol: "SHAZ", source: "sec-13g-2026-shaz-common" }],
  ["56501R106", { symbol: "MFC", source: "sec-13g-2026-mfc-common" }],
  ["40054J109", { symbol: "AERO", source: "sec-13g-2026-aero-common" }],
  ["37890B100", { symbol: "GBTG", source: "sec-13g-2025-gbtg-common" }],
  ["37637K108", { symbol: "GTLB", source: "sec-13g-2026-gtlb-common" }],
  ["07373V105", { symbol: "BEAM", source: "sec-13g-2026-beam-common" }],
  ["N69605108", { symbol: "PHVS", source: "sec-13g-2026-phvs-common" }],
  ["N5505D105", { symbol: "MICC", source: "sec-13g-2026-micc-common" }],
  ["H82027105", { symbol: "SOPH", source: "sec-13g-2026-soph-common" }],
  ["H50430232", { symbol: "LOGI", source: "sec-13g-2025-logi-common" }],
  ["G9600F104", { symbol: "VGNT", source: "sec-13g-2026-vgnt-common" }],
  ["G89479102", { symbol: "TRMD", source: "sec-13g-2024-trmd-common" }],
  ["G7553X106", { symbol: "KRSP", source: "sec-13g-2026-krsp-common" }],
  ["98420N105", { symbol: "XENE", source: "sec-13g-2026-xene-common" }],
  ["955306105", { symbol: "WST", source: "sec-13g-2026-wst-common" }],
  ["947002101", { symbol: "WLTH", source: "sec-13g-2026-wlth-common" }],
  ["92918V307", { symbol: "VRM", source: "sec-13g-2025-vrm-common" }],
  ["92857W308", { symbol: "VOD", source: "sec-13g-2026-vod-common" }],
  ["922967104", { symbol: "MANE", source: "sec-13g-2026-mane-common" }],
  ["91733P107", { symbol: "USAR", source: "sec-13g-2026-usar-common" }],
  ["90114C107", { symbol: "TUYA", source: "sec-13g-2025-tuya-common" }],
  ["89832Q109", { symbol: "TFC", source: "sec-13g-2026-tfc-common" }],
  ["88034P109", { symbol: "TME", source: "sec-13g-2026-tme-common" }],
  ["829401108", { symbol: "SION", source: "sec-13g-2026-sion-common" }],
  ["78475V103", { symbol: "MWH", source: "sec-13g-2026-mwh-common" }],
  ["775133101", { symbol: "ROG", source: "sec-13g-2026-rog-common" }],
  ["747906600", { symbol: "QMCO", source: "sec-13g-2025-qmco-common" }],
  ["70451X104", { symbol: "PAYO", source: "sec-13g-2026-payo-common" }],
  ["647581206", { symbol: "EDU", source: "sec-13g-2026-edu-common" }],
  ["639193101", { symbol: "NAVN", source: "sec-13g-2026-navn-common" }],
  ["608012308", { symbol: "MOGU", source: "sec-13g-2023-mogu-common" }],
  ["379577208", { symbol: "GMED", source: "sec-13g-2026-gmed-common" }],
  ["36322Q206", { symbol: "DMRA", source: "sec-13g-2026-dmra-common" }],
  ["26622P107", { symbol: "DOCS", source: "sec-13g-2026-docs-common" }],
  ["21217B100", { symbol: "CTNM", source: "sec-13g-2026-ctnm-common" }],
  ["099502106", { symbol: "BAH", source: "sec-13g-2026-bah-common" }],
  ["095924106", { symbol: "OTF", source: "sec-13g-2026-otf-common" }],
  ["03969T109", { symbol: "ARCT", source: "sec-13g-2026-arct-common" }],
  ["03676B102", { symbol: "AM", source: "sec-13g-2026-am-common" }],
  ["033853102", { symbol: "ANDG", source: "sec-13g-2026-andg-common" }],
  ["023193105", { symbol: "AMBQ", source: "sec-13g-2026-ambq-common" }],
  ["00138L108", { symbol: "RERE", source: "sec-13g-2026-rere-common" }],
  ["559222401", { symbol: "MGA", source: "sec-13g-2026-mga-common" }],
  ["00090Q103", { symbol: "ADT", source: "sec-13g-2026-adt-common" }],
  ["925283103", { symbol: "VSNT", source: "sec-13g-2026-vsnt-common" }],
  ["G48833118", { symbol: "WFRD", source: "sec-13g-2026-wfrd-common" }],
  ["04272N102", { symbol: "AVBP", source: "sec-13g-2026-avbp-common" }],
  ["482497104", { symbol: "BEKE", source: "sec-13g-2023-beke-common" }],
  ["92763W103", { symbol: "VIPS", source: "sec-13g-2026-vips-common" }],
  ["36165L108", { symbol: "GDS", source: "sec-13g-2026-gds-common" }],
  ["092667104", { symbol: "SRTA", source: "sec-13g-2026-srta-common" }],
  ["577128101", { symbol: "MATW", source: "sec-13g-2026-matw-common" }],
  ["89346D107", { symbol: "TAC", source: "sec-13g-2026-tac-common" }],
  ["024061103", { symbol: "DCH", source: "sec-13g-2026-dch-common" }],
  ["M6158M104", { symbol: "ITRN", source: "sec-13g-2026-itrn-common" }],
  ["536797103", { symbol: "LAD", source: "sec-13g-2026-lad-common" }],
  ["36472T109", { symbol: "TDAY", source: "sec-13g-2026-tday-common" }],
  ["12503M108", { symbol: "CBOE", source: "sec-13g-2026-cboe-common" }],
  ["44951W106", { symbol: "IESC", source: "sec-13g-2026-iesc-common" }],
  ["45781M101", { symbol: "INVA", source: "sec-13g-2026-inva-common" }],
  ["703481101", { symbol: "PTEN", source: "sec-13g-2026-pten-common" }],
  ["75776W103", { symbol: "RDW", source: "sec-13g-2025-rdw-common" }],
  ["20337X109", { symbol: "VISN", source: "sec-13g-2026-visn-common" }],
  ["942749102", { symbol: "WTS", source: "sec-13g-2026-wts-common" }],
  ["142339100", { symbol: "CSL", source: "sec-13g-2026-csl-common" }],
  ["68390D106", { symbol: "OR", source: "sec-13g-2026-or-common" }],
  ["10948W103", { symbol: "AAMI", source: "sec-13g-2026-aami-common" }],
  ["69121K104", { symbol: "OBDC", source: "sec-13g-2025-obdc-common" }],
  ["09581B103", { symbol: "OWL", source: "sec-13g-2026-owl-common" }],
  ["63001N106", { symbol: "NATL", source: "sec-13g-2026-natl-common" }],
  ["43300A203", { symbol: "HLT", source: "sec-13g-2026-hlt-common" }],
  ["934423104", { symbol: "WBD", source: "sec-13g-2026-wbd-common" }],
  ["72651A207", { symbol: "PAGP", source: "sec-13g-2026-pagp-common" }],
  ["55261F104", { symbol: "MTB", source: "sec-13g-2026-mtb-common" }],
  ["693506107", { symbol: "PPG", source: "sec-13g-2026-ppg-common" }],
  ["49845K101", { symbol: "KVYO", source: "sec-13g-2026-kvyo-common" }],
  ["G65163100", { symbol: "JOBY", source: "sec-13g-2026-joby-common" }],
  ["03945R102", { symbol: "ACHR", source: "sec-13g-2026-achr-common" }],
  ["00091E109", { symbol: "ABSI", source: "sec-13g-2026-absi-common" }],
]);
const LIBERTY_LIVE_NAME = "LIBERTY LIVE";
const AUTHORITATIVE_ALIAS_SOURCES = new Set(
  Array.from(AUTHORITATIVE_CUSIP_SYMBOLS.values(), (identity) => identity.source),
);

const LEGAL_WORDS = new Set([
  "ADR",
  "ADS",
  "AG",
  "BANCORP",
  "BK",
  "CAP",
  "CL",
  "CO",
  "COM",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "DEL",
  "ETF",
  "ETP",
  "FD",
  "FDS",
  "FINL",
  "GROUP",
  "HLDG",
  "HLDGS",
  "HOLDING",
  "HOLDINGS",
  "INC",
  "INTL",
  "L P",
  "LP",
  "LTD",
  "MGMT",
  "NEW",
  "NV",
  "ORD",
  "PLC",
  "SA",
  "SHS",
  "SPONSORED",
  "STK",
  "THE",
  "TR",
  "TRUST",
]);

// Fund-family and descriptor words name no single issuer, so they cannot
// confirm which security a stored ticker belongs to.
const NON_IDENTIFYING_WORDS = new Set([
  "AND",
  "AMERICA",
  "AMERICAN",
  "DIREXION",
  "FOR",
  "FUND",
  "FUNDS",
  "INDEX",
  "INVESCO",
  "ISHARES",
  "PORTFOLIO",
  "PROSHARES",
  "SCHWAB",
  "SECTOR",
  "SELECT",
  "SERIES",
  "SHARES",
  "SPDR",
  "VANECK",
  "VANGUARD",
  "WISDOMTREE",
]);

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return SYMBOL_RE.test(symbol) ? symbol : null;
}

function normalizeCusip(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeCompanyName(value) {
  const raw = String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bU\.?S\.?\b/g, " US ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "";

  const words = raw
    .split(" ")
    .filter((word) => word && !LEGAL_WORDS.has(word));

  return words.join(" ").trim();
}

function identityTokens(value) {
  return normalizeCompanyName(value)
    .split(" ")
    .filter((word) => word.length >= 2 && !NON_IDENTIFYING_WORDS.has(word));
}

// Stored 13F tickers and the aliases generated from them are not identity
// evidence: historical rows carry tickers such as ATI for IBM or Philip Morris.
// Confirm the candidate's issuer, not uniqueness across its listed share classes.
// Filing abbreviations may omit letters after an exact identifying word;
// every remaining word still has to agree. One shared word cannot confirm an issuer.
function issuerNameConfirms(symbolNames, symbol, issuerName) {
  // The common normalizer already removes abbreviated corporate descriptors.
  // Treat their expanded and filing-truncated forms the same here.
  const descriptors = new Set(["FINANCIAL", "INTERNATIONAL", "MANAGEMENT", "BANCORPORATION",
    "INCORPORATED", "LIMITED", "HLDNGS", "HOLD", "HOLDI", "IN", "PL", "CLASS"]);
  const words = (name) => normalizeCompanyName(String(name ?? "")
    .replace(/['’]/g, "")
    .replace(/\s*\/[A-Z]{2}\/?\s*$/i, "")
    .replace(/\s+-\s+US\b/gi, ""))
    .split(" ").filter((word) => word.length >= 2 && word !== "AND" && word !== "OF" && !descriptors.has(word));
  const issuerWords = words(issuerName);
  const first = issuerWords.find(word => !NON_IDENTIFYING_WORDS.has(word));
  if (!first) return false;
  for (const name of symbolNames.get(symbol) ?? []) {
    const candidateWords = words(name);
    if (!candidateWords.includes(first)) continue;
    if (issuerWords.length !== candidateWords.length) continue;
    const remaining = [...candidateWords];
    const abbreviated = [];
    for (const word of issuerWords) {
      const exact = remaining.indexOf(word);
      if (exact >= 0) remaining.splice(exact, 1);
      else abbreviated.push(word);
    }
    for (const word of abbreviated) {
      const index = remaining.findIndex(ownWord => {
        if (word.length < 3 || word.length >= ownWord.length || word[0] !== ownWord[0]) return false;
        let matched = 0;
        for (const letter of ownWord) if (letter === word[matched]) matched += 1;
        return matched === word.length;
      });
      if (index < 0) break;
      remaining.splice(index, 1);
    }
    if (!remaining.length) return true;
  }
  return false;
}

function addSymbolName(symbolNames, symbol, name) {
  if (!symbol || !String(name ?? "").trim()) return;
  if (!symbolNames.has(symbol)) symbolNames.set(symbol, new Set());
  symbolNames.get(symbol).add(String(name));
}

function addMapValue(map, key, value) {
  if (!key || !value?.symbol) return;
  if (!map.has(key)) map.set(key, value);
  else if (map.get(key).symbol?.replace(/-/g, ".") !== value.symbol.replace(/-/g, ".")) map.set(key, { symbol: null });
}

function addSymbol(symbols, value) {
  const symbol = normalizeSymbol(value);
  if (symbol) symbols.add(symbol);
  return symbol;
}

function addName(nameMap, rawName, symbol, source) {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) return;
  const normalized = normalizeCompanyName(rawName);
  addMapValue(nameMap, normalized, { symbol: cleanSymbol, source });
}

function addAlias(aliasMap, rawKey, normalizedKey, symbol, source) {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) return;
  const value = { symbol: cleanSymbol, source };
  const raw = String(rawKey ?? "").trim();
  if (raw) {
    addMapValue(aliasMap, raw.toUpperCase(), value);
    addMapValue(aliasMap, normalizeCompanyName(raw), value);
  }
  const normalized = String(normalizedKey ?? "").trim();
  if (normalized) {
    addMapValue(aliasMap, normalized.toUpperCase(), value);
    addMapValue(aliasMap, normalizeCompanyName(normalized), value);
  }
}

function loadStockUniverse(root, symbols, nameMap, symbolNames) {
  const analyzer = readJson(path.join(root, "data/global-scouter/core/stocks_analyzer.json"), {});
  for (const row of analyzer.data ?? []) {
    const symbol = addSymbol(symbols, row?.symbol);
    if (!symbol) continue;
    addName(nameMap, row?.companyName, symbol, "global-scouter");
    addSymbolName(symbolNames, symbol, row?.companyName);
  }

  const index = readJson(path.join(root, "data/global-scouter/core/stocks_index.json"), {});
  for (const [symbolKey, row] of Object.entries(index.stocks ?? {})) {
    const symbol = addSymbol(symbols, symbolKey);
    if (!symbol) continue;
    addName(nameMap, row?.n, symbol, "global-scouter");
    addSymbolName(symbolNames, symbol, row?.n);
  }
}

function loadYfUniverse(root, symbols, nameMap, symbolNames) {
  const yfDir = path.join(root, "data/yf/finance");
  if (!fs.existsSync(yfDir)) return;

  for (const file of fs.readdirSync(yfDir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const symbol = addSymbol(symbols, path.basename(file, ".json"));
    if (!symbol) continue;

    const payload = readJson(path.join(yfDir, file), {});
    const info = payload.data?.info ?? {};
    addName(nameMap, info.longName, symbol, "yf-local");
    addName(nameMap, info.shortName, symbol, "yf-local");
    addSymbolName(symbolNames, symbol, info.longName);
    addSymbolName(symbolNames, symbol, info.shortName);
  }
}

// SEC's ticker-to-registrant table supplies issuer names for confirmation only;
// it never creates a name join on its own.
function loadSecIssuerNames(root, symbolNames) {
  const doc = readJson(path.join(root, "data/edgar/company_tickers.json"), {});
  for (const row of doc.rows ?? []) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    for (const symbol of new Set([normalizeSymbol(ticker), normalizeSymbol(ticker.replace("-", "."))])) {
      addSymbolName(symbolNames, symbol, row?.title);
    }
  }
}

function loadExistingAliases(root, aliasMap, nameMap, symbolNames) {
  const aliasDoc = readJson(path.join(root, "data/sec-13f/analytics/ticker_aliases.json"), {});

  if (Array.isArray(aliasDoc.aliases)) {
    for (const alias of aliasDoc.aliases) {
      // Exact security evidence must not become an issuer/fund-family guess
      // for another class or CUSIP when generated aliases are loaded again.
      if (AUTHORITATIVE_ALIAS_SOURCES.has(alias.source) || Array.isArray(alias.cusips) && alias.cusips.some(
        (cusip) => AUTHORITATIVE_CUSIP_SYMBOLS.has(normalizeCusip(cusip)),
      )) continue;
      if (!issuerNameConfirms(symbolNames, normalizeSymbol(alias.symbol), alias.raw_key)) continue;
      addAlias(aliasMap, alias.raw_key, alias.normalized_key, alias.symbol, alias.source ?? "alias-history");
      addName(nameMap, alias.raw_key, alias.symbol, alias.source ?? "alias-history");
    }
    return;
  }

  if (aliasDoc.aliases && typeof aliasDoc.aliases === "object") {
    for (const [rawKey, symbol] of Object.entries(aliasDoc.aliases)) {
      if (!issuerNameConfirms(symbolNames, normalizeSymbol(symbol), rawKey)) continue;
      addAlias(aliasMap, rawKey, rawKey, symbol, "alias-history");
      addName(nameMap, rawKey, symbol, "alias-history");
    }
  }
}

function loadInvestorHistory(root, symbols, nameMap, cusipMap, symbolNames) {
  const investorsDir = path.join(root, "data/sec-13f/investors");
  if (!fs.existsSync(investorsDir)) return;

  for (const file of fs.readdirSync(investorsDir)) {
    if (!file.endsWith(".json")) continue;
    const payload = readJson(path.join(investorsDir, file), {});
    for (const filing of payload.investor?.filings ?? []) {
      for (const holding of filing.holdings ?? []) {
        const cusip = normalizeCusip(holding?.cusip);
        const authoritative = AUTHORITATIVE_CUSIP_SYMBOLS.get(cusip);
        if (authoritative) {
          addSymbol(symbols, authoritative.symbol);
          cusipMap.set(cusip, authoritative);
          continue;
        }
        const symbol = normalizeSymbol(holding?.ticker);
        if (!symbol || !issuerNameConfirms(symbolNames, symbol, holding?.name)) continue;
        addSymbol(symbols, symbol);

        addName(nameMap, holding?.name, symbol, "13f-history");
        if (cusip) addMapValue(cusipMap, cusip, { symbol, source: "13f-history" });
      }
    }
  }
}

export function loadTickerResolver(rootPath) {
  const root = path.resolve(rootPath);
  const symbols = new Set();
  const nameMap = new Map();
  const aliasMap = new Map();
  const cusipMap = new Map();
  const symbolNames = new Map();

  loadStockUniverse(root, symbols, nameMap, symbolNames);
  loadYfUniverse(root, symbols, nameMap, symbolNames);
  loadSecIssuerNames(root, symbolNames);
  loadExistingAliases(root, aliasMap, nameMap, symbolNames);
  loadInvestorHistory(root, symbols, nameMap, cusipMap, symbolNames);
  const confirmed = (symbol, issuerName) => issuerNameConfirms(symbolNames, normalizeSymbol(symbol), issuerName);

  function result(symbol, rawKey, normalizedKey, source, authoritative = false) {
    return {
      symbol: normalizeSymbol(symbol),
      rawKey: String(rawKey ?? "").trim(),
      normalizedKey: String(normalizedKey ?? "").trim(),
      source,
      authoritative,
    };
  }

  function resolveHoldingSymbol(holding) {
    const rawTicker = String(holding?.ticker ?? "").trim().toUpperCase();
    const rawName = String(holding?.name ?? "").trim();
    const rawCusip = normalizeCusip(holding?.cusip);
    const normalizedName = normalizeCompanyName(rawName);
    const rawKey = rawTicker || rawName || rawCusip;
    const normalizedKey = rawTicker || normalizedName || rawCusip;

    const authoritative = AUTHORITATIVE_CUSIP_SYMBOLS.get(rawCusip);
    if (authoritative) {
      return result(authoritative.symbol, rawKey, normalizedKey, authoritative.source, true);
    }
    if (normalizedName === LIBERTY_LIVE_NAME) {
      return result(null, rawKey, normalizedKey, "unmapped-liberty-live-without-exact-cusip");
    }
    const history = cusipMap.get(rawCusip);
    // A known or conflicting security identifier cannot be bypassed by a name
    // fallback or a stored ticker belonging to another security.
    const confirmsCandidate = (symbol) => confirmed(symbol, rawName)
      && (!cusipMap.has(rawCusip) || history?.symbol?.replace(/-/g, ".") === normalizeSymbol(symbol)?.replace(/-/g, "."));

    if (rawTicker) {
      const direct = normalizeSymbol(rawTicker);
      if (direct && confirmsCandidate(direct)) return result(direct, rawTicker, rawTicker, "ticker-direct");

      const alias = aliasMap.get(rawTicker) ?? aliasMap.get(normalizeCompanyName(rawTicker));
      if (alias?.symbol && confirmsCandidate(alias.symbol)) {
        return result(alias.symbol, rawTicker, normalizeCompanyName(rawTicker), alias.source);
      }
    }

    if (rawName) {
      const alias = aliasMap.get(rawName.toUpperCase()) ?? aliasMap.get(normalizedName);
      if (alias?.symbol && confirmsCandidate(alias.symbol)) return result(alias.symbol, rawName, normalizedName, alias.source);
    }

    if (rawCusip) {
      if (history?.symbol && confirmsCandidate(history.symbol)) return result(history.symbol, rawKey, normalizedKey, history.source);
    }

    if (rawName) {
      const hit = nameMap.get(normalizedName);
      if (hit?.symbol && confirmsCandidate(hit.symbol)) return result(hit.symbol, rawName, normalizedName, hit.source);
    }

    // A rejected stored ticker is not an identity key for the unmapped audit list.
    return result(null, rawName || rawCusip || rawTicker, normalizedName || rawCusip || rawTicker, "unmapped");
  }

  return {
    confirmed,
    symbols,
    nameMap,
    aliasMap,
    cusipMap,
    resolveHoldingSymbol,
  };
}
