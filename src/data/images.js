// Unsplash images for each story — curated for historical accuracy and visual impact
// Using Unsplash Source API for reliable, free images
const IMG = {
  1: "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=800&q=80", // Penicillin - petri dish / lab
  2: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=800&q=80", // Gutenberg - old books
  3: "https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=800&q=80", // Rosa Parks - civil rights
  4: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&q=80", // Moon landing
  5: "https://images.unsplash.com/photo-1560969184-10fe8719e047?w=800&q=80", // Berlin Wall
  6: "https://images.unsplash.com/photo-1590012314607-cda9d9b699ae?w=800&q=80", // Chains / abolition
  7: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80", // World Wide Web - digital globe
  8: "https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?w=800&q=80", // Smallpox - vaccine
  9: "https://images.unsplash.com/photo-1590012314607-cda9d9b699ae?w=800&q=80", // Magna Carta - old document
  10: "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=800&q=80", // DNA
  11: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Zheng He - ship/ocean
  12: "https://images.unsplash.com/photo-1461360228754-6e81c478b882?w=800&q=80", // Treaty - quill/document
  13: "https://images.unsplash.com/photo-1590012314607-cda9d9b699ae?w=800&q=80", // Haitian Revolution
  14: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80", // Green Revolution - wheat field
  15: "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=800&q=80", // Seneca Falls - protest
  16: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=80", // Newton - apple/physics
  17: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&q=80", // Einstein - space/cosmos
  18: "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=800&q=80", // Germ Theory - microscope
  19: "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=800&q=80", // Marie Curie - radiation
  20: "https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?w=800&q=80", // Darwin - nature
  21: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&q=80", // Copernicus - stars
  22: "https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=800&q=80", // End of Apartheid
  23: "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&q=80", // Indian Independence - Taj Mahal
  24: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=800&q=80", // French Revolution - Paris
  25: "https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=800&q=80", // Emancipation
  26: "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=800&q=80", // UDHR
  27: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Columbus - ship
  28: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Magellan - ship
  29: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&q=80", // Gagarin - space
  30: "https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=800&q=80", // Wright Brothers - flight
  31: "https://images.unsplash.com/photo-1596524430615-b46475ddff6e?w=800&q=80", // Telephone
  32: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80", // Steam Engine - industrial
  33: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80", // Transistor - circuit board
  34: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&q=80", // Cuban Missile Crisis
  35: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80", // D-Day
  36: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&q=80", // Nuremberg - justice
  37: "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=800&q=80", // Marshall Plan - Europe rebuild
  38: "https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=800&q=80", // Camp David - handshake/peace
  39: "https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&q=80", // Geneva - medical/cross
  40: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=800&q=80", // X-Rays - skeleton
  41: "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=800&q=80", // Human Genome - DNA
  42: "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=800&q=80", // Writing - ancient tablet
  43: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&q=80", // Library of Alexandria
  44: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&q=80", // Renaissance - art
  45: "https://images.unsplash.com/photo-1461896836934-bd45ba9e0afd?w=800&q=80", // Olympics - athletics
  46: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?w=800&q=80", // Rosetta Stone
  47: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&q=80", // Polio Vaccine
  48: "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=800&q=80", // Heart Transplant
  49: "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=800&q=80", // United Nations
  50: "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=800&q=80", // Constantinople - Istanbul
  51: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80", // Meiji - Japan
  52: "https://images.unsplash.com/photo-1452587925148-ce544e77e70d?w=800&q=80", // Photography - camera
  53: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Suez Canal - ship
  54: "https://images.unsplash.com/photo-1489824904134-891ab64532f1?w=800&q=80", // Assembly Line - car factory
  55: "https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=800&q=80", // Radio
  56: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Panama Canal
  57: "https://images.unsplash.com/photo-1562887250-9a52d844ad30?w=800&q=80", // Stonewall - pride
  58: "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=800&q=80", // Russia - landscape
  59: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=800&q=80", // Electricity - lightning
  60: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Spanish Armada - ship
  61: "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=800&q=80", // Enlightenment - books
  62: "https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&q=80", // Anesthesia - medical
  63: "https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=800&q=80", // Marco Polo - Silk Road
  64: "https://images.unsplash.com/photo-1551415923-a2297c7fda79?w=800&q=80", // South Pole - Antarctica
  65: "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=800&q=80", // NZ Suffrage
  66: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80", // Internet
  67: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&q=80", // Brown v Board - justice
  68: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80", // Haber-Bosch - field
  69: "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&q=80", // Da Gama - India
  70: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80", // Lewis & Clark - mountains
  71: "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=800&q=80", // Vikings - Nordic
  72: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80", // Telegraph - tech
  73: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?w=800&q=80", // Tutankhamun - Egypt
  74: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=800&q=80", // China - May Fourth
  75: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&q=80", // Vaccines
  76: "https://images.unsplash.com/photo-1461151304267-38535e780c79?w=800&q=80", // Television
  77: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&q=80", // Hiroshima
  78: "https://images.unsplash.com/photo-1461360228754-6e81c478b882?w=800&q=80", // Versailles - document
  79: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800&q=80", // Jazz
  80: "https://images.unsplash.com/photo-1504711434969-e33886168d6c?w=800&q=80", // Newspaper
  81: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80", // Black Death
  82: "https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=800&q=80", // Silk Road
  83: "https://images.unsplash.com/photo-1548625149-fc4a29cf7092?w=800&q=80", // Reformation - church
  84: "https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=800&q=80", // Declaration of Independence
  85: "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=800&q=80", // Russian Revolution
  86: "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=800&q=80", // Paper - ancient
  87: "https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?w=800&q=80", // Spanish Flu
  88: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?w=800&q=80", // Hammurabi
  89: "https://images.unsplash.com/photo-1555993539-1732b0258235?w=800&q=80", // Athens - democracy
  90: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?w=800&q=80", // Pyramids
  91: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&q=80", // Chernobyl
  92: "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=800&q=80", // Irish Famine
  93: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80", // Gunpowder
  94: "https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=800&q=80", // Berlin Airlift - plane
  95: "https://images.unsplash.com/photo-1489392191049-fc10c97e64b6?w=800&q=80", // Africa
  96: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&q=80", // Galileo - telescope/stars
  97: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=800&q=80", // Great Fire - fire
  98: "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=800&q=80", // Dolly - genetics
  99: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=800&q=80", // Terracotta Army - China
  100: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80", // Agricultural Revolution - field
  101: "https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=800&q=80", // Islamic Golden Age
  102: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800&q=80", // Beethoven - music
  103: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80", // Transcontinental Railroad
  104: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=800&q=80", // Tsunami - ocean wave
  105: "https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=800&q=80", // Compass - navigation
  106: "https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&q=80", // Blood Circulation
  107: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=800&q=80", // China - Foot Binding
  108: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80", // Bretton Woods - finance
  109: "https://images.unsplash.com/photo-1555993539-1732b0258235?w=800&q=80", // Vesuvius - Pompeii/Greece
  110: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=80", // Euclid - mathematics
  111: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=800&q=80", // Maxwell - electricity
  112: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80", // Trans-Siberian Railway
  113: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&q=80", // Universities - library
  114: "https://images.unsplash.com/photo-1489392191049-fc10c97e64b6?w=800&q=80", // Bandung - Africa/Asia
  115: "https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=800&q=80", // Mongol Conquests
  116: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800&q=80", // Piano - music
  117: "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=800&q=80", // Oxygen - chemistry
  118: "https://images.unsplash.com/photo-1555993539-1732b0258235?w=800&q=80", // Antikythera - Greece
  119: "https://images.unsplash.com/photo-1489392191049-fc10c97e64b6?w=800&q=80", // African Union
  120: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=800&q=80", // Neurons - brain scan
};

export default IMG;
