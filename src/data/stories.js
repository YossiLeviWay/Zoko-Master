import IMG from './images.js';
import { VIS, CATS, CAT_COLORS } from './constants.js';

// Story titles extracted from image curation comments
const TITLES = {
  1:"The Discovery of Penicillin",2:"Gutenberg's Printing Press",3:"Rosa Parks & the Bus Boycott",4:"The Moon Landing",5:"The Fall of the Berlin Wall",6:"The Abolition of Slavery",7:"The Birth of the World Wide Web",8:"The Eradication of Smallpox",9:"The Magna Carta",10:"The Discovery of DNA",
  11:"Zheng He's Voyages",12:"The Treaty of Westphalia",13:"The Haitian Revolution",14:"The Green Revolution",15:"The Seneca Falls Convention",16:"Newton's Principia",17:"Einstein's Theory of Relativity",18:"Germ Theory of Disease",19:"Marie Curie & Radioactivity",20:"Darwin's Theory of Evolution",
  21:"The Copernican Revolution",22:"The End of Apartheid",23:"Indian Independence",24:"The French Revolution",25:"The Emancipation Proclamation",26:"The Universal Declaration of Human Rights",27:"Columbus Reaches the Americas",28:"Magellan's Circumnavigation",29:"Yuri Gagarin in Space",30:"The Wright Brothers' First Flight",
  31:"The Invention of the Telephone",32:"The Steam Engine",33:"The Invention of the Transistor",34:"The Cuban Missile Crisis",35:"D-Day: The Normandy Landings",36:"The Nuremberg Trials",37:"The Marshall Plan",38:"The Camp David Accords",39:"The Geneva Conventions",40:"The Discovery of X-Rays",
  41:"The Human Genome Project",42:"The Invention of Writing",43:"The Library of Alexandria",44:"The Renaissance",45:"The Ancient Olympics",46:"The Rosetta Stone",47:"The Polio Vaccine",48:"The First Heart Transplant",49:"The Founding of the United Nations",50:"The Fall of Constantinople",
  51:"The Meiji Restoration",52:"The Invention of Photography",53:"The Opening of the Suez Canal",54:"The Assembly Line Revolution",55:"The Invention of Radio",56:"The Panama Canal",57:"The Stonewall Uprising",58:"The Russian Emancipation of Serfs",59:"Harnessing Electricity",60:"The Spanish Armada",
  61:"The Age of Enlightenment",62:"The Discovery of Anesthesia",63:"Marco Polo's Travels",64:"The Race to the South Pole",65:"New Zealand Women's Suffrage",66:"The Rise of the Internet",67:"Brown v. Board of Education",68:"The Haber-Bosch Process",69:"Vasco da Gama Reaches India",70:"The Lewis & Clark Expedition",
  71:"The Viking Age",72:"The Electric Telegraph",73:"The Discovery of Tutankhamun's Tomb",74:"China's May Fourth Movement",75:"The History of Vaccination",76:"The Invention of Television",77:"Hiroshima & Nagasaki",78:"The Treaty of Versailles",79:"The Birth of Jazz",80:"The Rise of the Newspaper",
  81:"The Black Death",82:"The Silk Road",83:"The Protestant Reformation",84:"The Declaration of Independence",85:"The Russian Revolution",86:"The Invention of Paper",87:"The Spanish Flu Pandemic",88:"The Code of Hammurabi",89:"Athenian Democracy",90:"The Building of the Pyramids",
  91:"The Chernobyl Disaster",92:"The Irish Famine",93:"The Invention of Gunpowder",94:"The Berlin Airlift",95:"The Scramble for Africa",96:"Galileo's Telescope",97:"The Great Fire of London",98:"Dolly the Cloned Sheep",99:"The Terracotta Army",100:"The Agricultural Revolution",
  101:"The Islamic Golden Age",102:"Beethoven's Symphonies",103:"The Transcontinental Railroad",104:"The 2004 Indian Ocean Tsunami",105:"The Invention of the Compass",106:"The Discovery of Blood Circulation",107:"The End of Foot Binding",108:"The Bretton Woods Agreement",109:"The Eruption of Vesuvius",110:"Euclid's Elements",
  111:"Maxwell's Equations",112:"The Trans-Siberian Railway",113:"The Birth of Universities",114:"The Bandung Conference",115:"The Mongol Conquests",116:"The Evolution of the Piano",117:"The Discovery of Oxygen",118:"The Antikythera Mechanism",119:"The African Union",120:"Mapping the Human Brain"
};

const YEARS = {
  1:"1928",2:"1440",3:"1955",4:"1969",5:"1989",6:"1833",7:"1989",8:"1980",9:"1215",10:"1953",
  11:"1405",12:"1648",13:"1791",14:"1960s",15:"1848",16:"1687",17:"1905",18:"1860s",19:"1898",20:"1859",
  21:"1543",22:"1994",23:"1947",24:"1789",25:"1863",26:"1948",27:"1492",28:"1519",29:"1961",30:"1903",
  31:"1876",32:"1712",33:"1947",34:"1962",35:"1944",36:"1945",37:"1948",38:"1978",39:"1864",40:"1895",
  41:"2003",42:"c. 3400 BCE",43:"c. 283 BCE",44:"14th c.",45:"776 BCE",46:"196 BCE",47:"1955",48:"1967",49:"1945",50:"1453",
  51:"1868",52:"1826",53:"1869",54:"1913",55:"1895",56:"1914",57:"1969",58:"1861",59:"1882",60:"1588",
  61:"1700s",62:"1846",63:"1271",64:"1911",65:"1893",66:"1983",67:"1954",68:"1909",69:"1498",70:"1804",
  71:"793",72:"1837",73:"1922",74:"1919",75:"1796",76:"1927",77:"1945",78:"1919",79:"1900s",80:"1600s",
  81:"1347",82:"130 BCE",83:"1517",84:"1776",85:"1917",86:"105 CE",87:"1918",88:"c. 1754 BCE",89:"508 BCE",90:"c. 2560 BCE",
  91:"1986",92:"1845",93:"9th c.",94:"1948",95:"1881",96:"1609",97:"1666",98:"1996",99:"246 BCE",100:"c. 10000 BCE",
  101:"8th c.",102:"1800s",103:"1869",104:"2004",105:"11th c.",106:"1628",107:"1912",108:"1944",109:"79 CE",110:"c. 300 BCE",
  111:"1865",112:"1891",113:"1088",114:"1955",115:"1206",116:"1700s",117:"1774",118:"c. 100 BCE",119:"2002",120:"2013"
};

const CAT_MAP = {
  1:"science",2:"technology",3:"rights",4:"exploration",5:"war-peace",6:"rights",7:"technology",8:"science",9:"rights",10:"science",
  11:"exploration",12:"war-peace",13:"rights",14:"science",15:"rights",16:"science",17:"science",18:"science",19:"science",20:"science",
  21:"science",22:"rights",23:"rights",24:"war-peace",25:"rights",26:"rights",27:"exploration",28:"exploration",29:"exploration",30:"technology",
  31:"technology",32:"technology",33:"technology",34:"war-peace",35:"war-peace",36:"rights",37:"war-peace",38:"war-peace",39:"rights",40:"science",
  41:"science",42:"culture",43:"culture",44:"culture",45:"culture",46:"culture",47:"science",48:"science",49:"rights",50:"war-peace",
  51:"culture",52:"technology",53:"technology",54:"technology",55:"technology",56:"technology",57:"rights",58:"rights",59:"technology",60:"war-peace",
  61:"culture",62:"science",63:"exploration",64:"exploration",65:"rights",66:"technology",67:"rights",68:"science",69:"exploration",70:"exploration",
  71:"exploration",72:"technology",73:"culture",74:"rights",75:"science",76:"technology",77:"war-peace",78:"war-peace",79:"culture",80:"culture",
  81:"war-peace",82:"exploration",83:"culture",84:"rights",85:"war-peace",86:"technology",87:"science",88:"culture",89:"rights",90:"culture",
  91:"technology",92:"war-peace",93:"technology",94:"war-peace",95:"war-peace",96:"science",97:"culture",98:"science",99:"culture",100:"science",
  101:"culture",102:"culture",103:"technology",104:"war-peace",105:"technology",106:"science",107:"rights",108:"war-peace",109:"culture",110:"science",
  111:"science",112:"technology",113:"culture",114:"rights",115:"war-peace",116:"culture",117:"science",118:"technology",119:"rights",120:"science"
};

const BLURBS = {
  1:"Alexander Fleming's accidental discovery of penicillin in 1928 launched the antibiotic revolution, saving an estimated 200 million lives and transforming medicine forever.",
  2:"Johannes Gutenberg's movable-type printing press democratized knowledge, sparking the Renaissance, the Reformation, and the Scientific Revolution by making books affordable.",
  3:"When Rosa Parks refused to give up her bus seat in Montgomery, Alabama, she ignited a 381-day boycott that became a defining moment of the American civil rights movement.",
  4:"On July 20, 1969, Neil Armstrong and Buzz Aldrin became the first humans to walk on the Moon, fulfilling Kennedy's bold promise and uniting the world in wonder.",
  5:"The fall of the Berlin Wall on November 9, 1989 symbolized the end of the Cold War and the reunification of Germany after 28 years of division.",
  6:"The British Slavery Abolition Act of 1833 freed over 800,000 enslaved people across the British Empire, part of a global movement that would reshape the modern world.",
  7:"Tim Berners-Lee's invention of the World Wide Web in 1989 at CERN connected humanity in ways never before imagined, revolutionizing communication, commerce, and culture.",
  8:"The World Health Organization declared smallpox eradicated in 1980 — the first and only human disease to be completely eliminated through vaccination.",
  9:"Signed in 1215, the Magna Carta established that even the king was subject to law, planting the seeds of constitutional governance and individual rights.",
  10:"Watson and Crick's 1953 discovery of DNA's double helix structure unlocked the secret of life itself, enabling modern genetics, forensics, and biotechnology.",
  11:"Admiral Zheng He commanded fleets of hundreds of ships across the Indian Ocean decades before European exploration, projecting Ming China's power across Asia and Africa.",
  12:"The 1648 Treaty of Westphalia ended the Thirty Years' War and established the modern concept of state sovereignty — the foundation of international relations today.",
  13:"The Haitian Revolution (1791–1804) was the only successful large-scale slave revolt in history, establishing Haiti as the first free Black republic in the Western Hemisphere.",
  14:"Norman Borlaug's Green Revolution introduced high-yield crop varieties that saved over a billion people from starvation, earning him the Nobel Peace Prize.",
  15:"The 1848 Seneca Falls Convention launched the organized women's suffrage movement in America, with the radical declaration that 'all men and women are created equal.'",
  16:"Newton's Principia Mathematica (1687) unified terrestrial and celestial mechanics, giving humanity the mathematical laws governing the universe.",
  17:"Einstein's 1905 papers on special relativity and E=mc² revolutionized physics, revealing that space and time are intertwined and mass is a form of energy.",
  18:"Louis Pasteur and Robert Koch's germ theory replaced centuries of superstition, proving that microorganisms cause disease and enabling modern sanitation and medicine.",
  19:"Marie Curie's pioneering research on radioactivity won her two Nobel Prizes and opened entirely new fields of physics and medicine, though at the cost of her own health.",
  20:"Darwin's On the Origin of Species (1859) introduced natural selection, fundamentally changing our understanding of life and humanity's place in nature.",
  21:"Copernicus's heliocentric model, published in 1543, displaced Earth from the center of the universe and ignited the Scientific Revolution.",
  22:"Nelson Mandela's release in 1990 and election as president in 1994 ended apartheid in South Africa, proving that reconciliation could triumph over decades of injustice.",
  23:"India's independence in 1947 ended nearly 200 years of British colonial rule, inspired by Gandhi's philosophy of nonviolent resistance that influenced movements worldwide.",
  24:"The French Revolution of 1789 overthrew the monarchy and proclaimed liberty, equality, and fraternity — ideals that would reshape governments across the globe.",
  25:"Lincoln's Emancipation Proclamation of 1863 declared freedom for enslaved people in Confederate states, transforming the Civil War into a fight for human liberty.",
  26:"Adopted in 1948, the UDHR established for the first time that fundamental human rights should be universally protected — a milestone in the history of human dignity.",
  27:"Columbus's 1492 voyage across the Atlantic initiated permanent contact between the Eastern and Western hemispheres, forever changing the course of human history.",
  28:"Magellan's expedition (1519–1522) completed the first circumnavigation of the globe, proving Earth's true size and connecting the world's oceans.",
  29:"On April 12, 1961, Soviet cosmonaut Yuri Gagarin became the first human in space, orbiting Earth in 108 minutes and opening the era of human spaceflight.",
  30:"On December 17, 1903, the Wright Brothers achieved the first powered, sustained flight at Kitty Hawk — 12 seconds that changed transportation forever.",
  31:"Alexander Graham Bell's 1876 telephone patent launched a communications revolution that connected the world in real time for the first time in history.",
  32:"Thomas Newcomen's 1712 steam engine, later improved by James Watt, powered the Industrial Revolution and transformed human civilization from agrarian to industrial.",
  33:"The invention of the transistor at Bell Labs in 1947 miniaturized electronics, making possible everything from radios to smartphones to the modern digital world.",
  34:"For 13 days in October 1962, the world stood on the brink of nuclear war as the US and USSR confronted each other over Soviet missiles in Cuba.",
  35:"On June 6, 1944, Allied forces launched the largest amphibious invasion in history on the beaches of Normandy, turning the tide of World War II in Europe.",
  36:"The Nuremberg Trials (1945–1946) established that individuals — even heads of state — could be held accountable for crimes against humanity under international law.",
  37:"The Marshall Plan invested $13 billion to rebuild war-devastated Europe, preventing economic collapse and laying the foundation for decades of peace and prosperity.",
  38:"The 1978 Camp David Accords brokered peace between Egypt and Israel — the first peace treaty between Israel and an Arab nation, mediated by President Carter.",
  39:"The 1864 Geneva Convention established humanitarian rules for warfare, protecting wounded soldiers and prisoners — the foundation of modern international humanitarian law.",
  40:"Wilhelm Röntgen's 1895 discovery of X-rays revolutionized medicine by allowing doctors to see inside the human body without surgery for the first time.",
  41:"The Human Genome Project (1990–2003) mapped all 3 billion base pairs of human DNA, ushering in the era of personalized medicine and genetic research.",
  42:"The invention of writing around 3400 BCE in Mesopotamia enabled the recording of history, laws, and knowledge — the foundation of civilization itself.",
  43:"The Library of Alexandria was the ancient world's greatest repository of knowledge, housing hundreds of thousands of scrolls and attracting scholars from across the Mediterranean.",
  44:"The Renaissance (14th–17th centuries) was a cultural rebirth in Europe that produced Leonardo, Michelangelo, and Shakespeare, transforming art, science, and thought.",
  45:"The ancient Olympics, first held in 776 BCE at Olympia, Greece, united warring city-states in athletic competition and inspired the modern Olympic Games.",
  46:"The Rosetta Stone, discovered in 1799, provided the key to deciphering Egyptian hieroglyphs, unlocking 3,000 years of ancient Egyptian history and culture.",
  47:"Jonas Salk's polio vaccine, announced in 1955, virtually eliminated a disease that had paralyzed thousands of children each year. He refused to patent it.",
  48:"Dr. Christiaan Barnard performed the first human heart transplant in 1967 in Cape Town, South Africa, pioneering an era of organ transplantation surgery.",
  49:"The United Nations, founded in 1945 after the devastation of WWII, created a framework for international cooperation, peacekeeping, and the protection of human rights.",
  50:"The fall of Constantinople to the Ottoman Turks in 1453 ended the Byzantine Empire, shifted global trade routes, and helped trigger the Age of Exploration.",
  51:"The Meiji Restoration of 1868 transformed Japan from a feudal society into a modern industrial power in just a few decades — one of history's most dramatic transformations.",
  52:"The invention of photography in the 1820s captured reality for the first time, revolutionizing art, journalism, science, and how we remember the past.",
  53:"The Suez Canal, opened in 1869, connected the Mediterranean and Red Seas, dramatically shortening trade routes between Europe and Asia.",
  54:"Henry Ford's moving assembly line (1913) revolutionized manufacturing, making automobiles affordable for the masses and setting the template for modern industrial production.",
  55:"Guglielmo Marconi's development of radio in the 1890s enabled wireless communication across oceans, transforming news, entertainment, and emergency communication forever.",
  56:"The Panama Canal, completed in 1914 after decades of effort and thousands of lives lost, connected the Atlantic and Pacific oceans and reshaped global trade.",
  57:"The 1969 Stonewall uprising in New York City catalyzed the modern LGBTQ+ rights movement, transforming a marginalized community's fight for equality into a global cause.",
  58:"Tsar Alexander II's 1861 emancipation freed 23 million Russian serfs, the largest single act of emancipation in history, though true equality remained elusive.",
  59:"Thomas Edison's 1882 Pearl Street power station brought electric light to Manhattan, launching the electrification of the world and ending millennia of dependence on fire.",
  60:"The defeat of the Spanish Armada in 1588 ended Spain's dominance of the seas and shifted global power toward England, shaping the modern English-speaking world.",
  61:"The Enlightenment championed reason, science, and individual rights, producing thinkers like Voltaire, Locke, and Kant who laid the intellectual foundation for modern democracy.",
  62:"The first use of ether anesthesia during surgery in 1846 eliminated the agony of operations, transforming surgery from a horrifying ordeal into a life-saving practice.",
  63:"Marco Polo's 24-year journey (1271–1295) along the Silk Road opened European eyes to the wonders of Asia and inspired centuries of exploration and trade.",
  64:"The race between Amundsen and Scott to reach the South Pole in 1911 was a dramatic tale of planning, endurance, and tragedy at the ends of the Earth.",
  65:"In 1893, New Zealand became the first self-governing country to grant women the right to vote, setting a precedent that would spread across the globe.",
  66:"The development of the Internet from a 1960s military project to a global network transformed every aspect of modern life — communication, commerce, knowledge, and culture.",
  67:"The Supreme Court's 1954 Brown v. Board ruling declared school segregation unconstitutional, striking at the heart of Jim Crow and energizing the civil rights movement.",
  68:"The Haber-Bosch process for synthesizing ammonia (1909) enabled mass production of fertilizer, feeding billions — but also provided explosives for two world wars.",
  69:"Vasco da Gama's 1498 voyage to India established a sea route from Europe to Asia, launching the Portuguese maritime empire and the age of global trade.",
  70:"Lewis and Clark's 1804–1806 expedition mapped the American West, documenting hundreds of plant and animal species and opening the continent to westward expansion.",
  71:"The Viking Age (793–1066) saw Norse seafarers explore, trade, and settle from North America to Constantinople, connecting distant civilizations across vast distances.",
  72:"Samuel Morse's electric telegraph (1837) enabled near-instantaneous long-distance communication, shrinking the world and revolutionizing business, journalism, and diplomacy.",
  73:"Howard Carter's 1922 discovery of Tutankhamun's nearly intact tomb captivated the world and sparked a global fascination with ancient Egypt that endures today.",
  74:"The May Fourth Movement of 1919 was a turning point in Chinese history, as students and intellectuals demanded modernization, democracy, and national dignity.",
  75:"Edward Jenner's 1796 smallpox vaccine was the world's first vaccine, pioneering immunization and saving countless millions of lives over the following centuries.",
  76:"The invention of television in the 1920s brought moving images into homes worldwide, transforming entertainment, news, politics, and culture in the 20th century.",
  77:"The atomic bombings of Hiroshima and Nagasaki in August 1945 ended World War II but opened the nuclear age, forever changing the calculus of war and peace.",
  78:"The 1919 Treaty of Versailles ended World War I but imposed harsh terms on Germany, sowing seeds of resentment that would contribute to World War II.",
  79:"Born in New Orleans around 1900, jazz fused African rhythms, blues, and improvisation into America's most original art form, influencing music worldwide.",
  80:"The rise of newspapers in the 1600s created the first mass media, enabling public discourse, political accountability, and the spread of ideas across societies.",
  81:"The Black Death (1347–1351) killed up to 60% of Europe's population, restructuring society, economics, and culture in ways that shaped the modern world.",
  82:"The Silk Road connected China to Rome for centuries, enabling the exchange of goods, ideas, religions, and technologies that shaped civilizations across Eurasia.",
  83:"Martin Luther's 95 Theses in 1517 challenged the Catholic Church's authority, sparking the Protestant Reformation and reshaping Christianity, politics, and European culture.",
  84:"The Declaration of Independence (1776) proclaimed that governments derive their power from the consent of the governed — a revolutionary idea that inspired nations worldwide.",
  85:"The Russian Revolution of 1917 overthrew the Tsar and established the Soviet Union, reshaping global politics for the entire 20th century.",
  86:"The invention of paper in China around 105 CE enabled the recording and spreading of knowledge far more efficiently than bamboo, silk, or clay tablets.",
  87:"The 1918 Spanish Flu infected a third of the world's population and killed 50–100 million people — more than World War I itself.",
  88:"The Code of Hammurabi (c. 1754 BCE) is one of the earliest known written legal codes, establishing the principle that laws should be publicly known and consistently applied.",
  89:"Athenian democracy, established around 508 BCE, was the world's first known democracy, where citizens directly voted on laws and policy — the seed of modern democratic governance.",
  90:"The Great Pyramids of Giza, built around 2560 BCE, remain one of humanity's most awe-inspiring achievements — monuments to engineering, ambition, and the power of organized labor.",
  91:"The 1986 Chernobyl nuclear disaster released 400 times more radiation than the Hiroshima bomb, reshaping global attitudes toward nuclear energy and Soviet transparency.",
  92:"The Irish Famine (1845–1852) killed one million people and forced another million to emigrate, reshaping Ireland's demographics and culture for generations.",
  93:"The invention of gunpowder in 9th-century China transformed warfare, eventually spreading to Europe where it rendered castles and armor obsolete and changed the balance of power.",
  94:"The Berlin Airlift (1948–1949) supplied West Berlin by air for 11 months during the Soviet blockade, demonstrating Western resolve and becoming an early Cold War triumph.",
  95:"The Scramble for Africa (1881–1914) saw European powers carve up an entire continent, imposing borders and colonial rule whose effects are still felt today.",
  96:"Galileo's improvements to the telescope in 1609 revealed Jupiter's moons, lunar craters, and Venus's phases — evidence that forever changed our view of the cosmos.",
  97:"The Great Fire of London in 1666 destroyed 13,000 houses and 87 churches, but led to the city's rebuilding in stone and brick under Christopher Wren.",
  98:"The cloning of Dolly the sheep in 1996 proved that adult cells could be reprogrammed, opening new frontiers in genetics, medicine, and bioethics.",
  99:"The Terracotta Army, discovered in 1974, consists of thousands of life-sized clay soldiers guarding the tomb of China's first emperor — one of archaeology's greatest finds.",
  100:"The Agricultural Revolution (c. 10,000 BCE) transformed humans from nomadic hunter-gatherers into settled farmers, enabling the rise of cities, writing, and civilization.",
  101:"The Islamic Golden Age (8th–14th centuries) preserved and advanced Greek, Persian, and Indian knowledge in mathematics, astronomy, medicine, and philosophy during Europe's Dark Ages.",
  102:"Beethoven's symphonies, composed between 1800 and 1824, expanded the emotional and structural possibilities of music, bridging the Classical and Romantic eras.",
  103:"The Transcontinental Railroad, completed in 1869, connected America's coasts by rail, unifying the nation and accelerating westward expansion, commerce, and communication.",
  104:"The 2004 Indian Ocean tsunami killed over 230,000 people across 14 countries, leading to the creation of global early warning systems and international disaster response frameworks.",
  105:"The magnetic compass, developed in China around the 11th century, enabled reliable ocean navigation, making possible the great voyages of exploration that connected the world.",
  106:"William Harvey's 1628 discovery that blood circulates through the body overturned 1,400 years of medical dogma and laid the foundation for modern cardiovascular medicine.",
  107:"The end of foot binding in China after 1912 liberated millions of women from a thousand-year practice that had crippled them in the name of beauty.",
  108:"The 1944 Bretton Woods Agreement created the World Bank and IMF, establishing the international monetary system that governed global finance for decades.",
  109:"The eruption of Mount Vesuvius in 79 CE buried Pompeii and Herculaneum, preserving a snapshot of Roman daily life in extraordinary detail for archaeologists to discover centuries later.",
  110:"Euclid's Elements (c. 300 BCE) systematized geometry and mathematical proof, remaining the standard textbook for over 2,000 years — the most influential math book ever written.",
  111:"James Clerk Maxwell's equations (1865) unified electricity, magnetism, and light into a single framework, paving the way for radio, television, and modern telecommunications.",
  112:"The Trans-Siberian Railway (completed 1916) stretched nearly 6,000 miles across Russia, connecting Moscow to the Pacific and opening Siberia to settlement and development.",
  113:"The University of Bologna, founded in 1088, was the first university in the Western world, establishing the model of higher education that spread across Europe and the globe.",
  114:"The 1955 Bandung Conference brought together 29 Asian and African nations, asserting the right of colonized peoples to self-determination and launching the Non-Aligned Movement.",
  115:"Genghis Khan's Mongol conquests (1206–1227) created the largest contiguous land empire in history, connecting East and West through trade, communication, and cultural exchange.",
  116:"The piano's evolution from harpsichord to modern grand (1700s–1800s) created the most versatile instrument in Western music, enabling new forms of expression and composition.",
  117:"The discovery of oxygen by Priestley and Lavoisier in the 1770s overturned phlogiston theory and launched modern chemistry as a rigorous science.",
  118:"The Antikythera mechanism (c. 100 BCE), an ancient Greek analog computer, tracked astronomical positions with astonishing precision — technology not matched for over a thousand years.",
  119:"The African Union, established in 2002, united 55 member states to promote peace, security, and development across the continent — building on the legacy of the OAU.",
  120:"The Human Brain Mapping project (2013–present) aims to map every neural connection in the brain, promising breakthroughs in neuroscience, AI, and treating brain disorders."
};

// Build the full stories array
export const STORIES = Object.keys(TITLES).map(id => {
  const n = Number(id);
  return {
    id: n,
    title: TITLES[n],
    year: YEARS[n],
    category: CAT_MAP[n],
    blurb: BLURBS[n],
    emoji: VIS[n]?.em || '📜',
    gradient: VIS[n]?.g || 'linear-gradient(135deg, #1a1028, #863bff)',
    image: IMG[n],
  };
});

export function getStory(id) {
  return STORIES.find(s => s.id === Number(id));
}

export function getStoriesByCategory(cat) {
  if (!cat || cat === 'all') return STORIES;
  return STORIES.filter(s => s.category === cat);
}

export function getRandomStory(excludeId) {
  const pool = excludeId ? STORIES.filter(s => s.id !== excludeId) : STORIES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getCategoryMeta(catId) {
  const cat = CATS.find(c => c.id === catId);
  const colors = CAT_COLORS[catId];
  return { ...cat, ...colors };
}
