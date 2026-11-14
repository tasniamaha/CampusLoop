// Vocabulary for the synthetic lost-and-found set: item kinds, colours, brands and campus places.
// Variety here is the noise: noun synonyms, colour words, brand aliases and place phrasings that
// a real student would use for the same thing.

/** The planned fixed colour list for the report form (about 12 colours plus "other"). */
export const COLORS = [
  'black', 'white', 'grey', 'silver', 'gold', 'red', 'orange',
  'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'other',
] as const;
export type Color = (typeof COLORS)[number];

/** Words people write in free text for each colour field value. */
export const COLOR_WORDS: Record<Color, readonly string[]> = {
  black: ['black', 'jet black', 'matte black'],
  white: ['white', 'off-white', 'cream'],
  grey: ['grey', 'gray', 'charcoal', 'dark grey'],
  silver: ['silver', 'metallic silver', 'chrome'],
  gold: ['gold', 'golden', 'rose gold'],
  red: ['red', 'maroon', 'burgundy', 'dark red'],
  orange: ['orange', 'bright orange'],
  yellow: ['yellow', 'mustard'],
  green: ['green', 'olive', 'dark green', 'mint green'],
  blue: ['blue', 'navy', 'navy blue', 'light blue', 'sky blue', 'dark blue'],
  purple: ['purple', 'violet', 'lavender'],
  pink: ['pink', 'light pink', 'hot pink'],
  brown: ['brown', 'tan', 'beige', 'dark brown'],
  other: ['multicoloured', 'patterned', 'camo'],
};

/** Colours a finder plausibly records instead of the owner's (lighting, shade, wear). */
export const COLOR_NEIGHBOURS: Record<Color, readonly Color[]> = {
  black: ['grey', 'blue'],
  white: ['silver', 'grey'],
  grey: ['black', 'silver'],
  silver: ['grey', 'white'],
  gold: ['yellow', 'brown'],
  red: ['pink', 'orange'],
  orange: ['red', 'yellow'],
  yellow: ['gold', 'orange'],
  green: ['blue'],
  blue: ['purple', 'black', 'green'],
  purple: ['blue', 'pink'],
  pink: ['red', 'purple'],
  brown: ['orange', 'black'],
  other: ['black'],
};

export type Brand = { name: string; aliases: readonly string[] };

export type Kind = {
  key: string;
  /** What people type in the free-text category field, weighted. */
  categories: readonly (readonly [string, number])[];
  nouns: readonly string[];
  brands: readonly Brand[];
  colors: readonly Color[];
  details: readonly string[];
  /** Kinds that look alike and make good hard negatives. */
  confusable: readonly string[];
};

const b = (name: string, ...aliases: string[]): Brand => ({ name, aliases });

export const KINDS: readonly Kind[] = [
  {
    key: 'phone',
    categories: [['Electronics', 6], ['Phone', 2], ['Mobile phone', 1], ['Electronic devices', 1]],
    nouns: ['phone', 'mobile phone', 'smartphone', 'cellphone', 'mobile'],
    brands: [b('Samsung', 'Samsung Galaxy'), b('Apple', 'iPhone'), b('Xiaomi', 'Redmi', 'Mi'), b('Realme'), b('Oppo'), b('Vivo')],
    colors: ['black', 'blue', 'silver', 'gold', 'white', 'green', 'purple'],
    details: ['in a clear silicone case', 'with a cracked screen protector', 'in a flip cover', 'with a ring holder on the back', 'with a pop socket'],
    confusable: ['powerbank'],
  },
  {
    key: 'laptop',
    categories: [['Electronics', 6], ['Laptop', 3], ['Computer', 1]],
    nouns: ['laptop', 'notebook computer', 'laptop computer'],
    brands: [b('Dell'), b('HP', 'Hewlett-Packard'), b('Lenovo', 'ThinkPad'), b('Apple', 'MacBook'), b('Asus'), b('Acer')],
    colors: ['silver', 'grey', 'black', 'blue'],
    details: ['with stickers on the lid', 'in a padded sleeve', 'with a worn keyboard', 'with a small dent on one corner'],
    confusable: ['charger'],
  },
  {
    key: 'earbuds',
    categories: [['Electronics', 5], ['Audio', 2], ['Accessories', 2]],
    nouns: ['earbuds', 'wireless earbuds', 'earphones', 'earbuds case', 'TWS earbuds'],
    brands: [b('Apple', 'AirPods'), b('Samsung', 'Galaxy Buds'), b('JBL'), b('Sony'), b('Anker', 'Soundcore')],
    colors: ['white', 'black', 'blue', 'grey'],
    details: ['in the charging case', 'with one bud missing', 'with a silicone cover on the case', 'with a keychain loop on the case'],
    confusable: ['headphones'],
  },
  {
    key: 'headphones',
    categories: [['Electronics', 5], ['Audio', 3]],
    nouns: ['headphones', 'headset', 'over-ear headphones', 'wireless headphones'],
    brands: [b('Sony'), b('JBL'), b('Bose'), b('Logitech')],
    colors: ['black', 'white', 'blue', 'silver'],
    details: ['with worn ear cushions', 'with a detachable cable', 'folded flat', 'with a scratch on the headband'],
    confusable: ['earbuds'],
  },
  {
    key: 'charger',
    categories: [['Electronics', 5], ['Accessories', 3], ['Charger', 2]],
    nouns: ['charger', 'charging adapter', 'power adapter', 'phone charger', 'laptop charger'],
    brands: [b('Anker'), b('Samsung'), b('Apple'), b('Baseus')],
    colors: ['white', 'black'],
    details: ['with a USB-C cable', 'with a long braided cable', 'with the cable wrapped around it', 'with a two-pin plug'],
    confusable: ['powerbank'],
  },
  {
    key: 'powerbank',
    categories: [['Electronics', 6], ['Accessories', 2]],
    nouns: ['power bank', 'portable charger', 'battery pack', 'powerbank'],
    brands: [b('Xiaomi', 'Mi'), b('Anker'), b('Baseus')],
    colors: ['black', 'white', 'blue', 'grey'],
    details: ['with a short cable attached', '20000 mAh', 'with a scratched case', 'with an LED display'],
    confusable: ['charger', 'phone'],
  },
  {
    key: 'calculator',
    categories: [['Electronics', 3], ['Stationery', 4], ['Calculator', 3]],
    nouns: ['calculator', 'scientific calculator'],
    brands: [b('Casio'), b('Texas Instruments', 'TI'), b('Sharp')],
    colors: ['black', 'grey', 'blue', 'white'],
    details: ['with a slide-on cover', 'with a name sticker scratched off', 'with a cracked cover', 'with a worn on key'],
    confusable: [],
  },
  {
    key: 'usb',
    categories: [['Electronics', 6], ['Accessories', 2], ['Storage', 1]],
    nouns: ['USB drive', 'flash drive', 'pen drive', 'thumb drive'],
    brands: [b('SanDisk', 'Sandisk'), b('Kingston'), b('Transcend')],
    colors: ['black', 'silver', 'red', 'blue'],
    details: ['on a keyring', 'with a missing cap', 'with a lanyard', 'metal body'],
    confusable: [],
  },
  {
    key: 'watch',
    categories: [['Accessories', 5], ['Watch', 3], ['Electronics', 2]],
    nouns: ['watch', 'wristwatch', 'smartwatch', 'fitness band'],
    brands: [b('Casio'), b('Xiaomi', 'Mi Band'), b('Apple', 'Apple Watch'), b('Fossil')],
    colors: ['black', 'silver', 'gold', 'brown', 'blue'],
    details: ['with a leather strap', 'with a metal strap', 'with a rubber strap', 'with a scratched face'],
    confusable: [],
  },
  {
    key: 'bottle',
    categories: [['Bottle', 4], ['Personal items', 3], ['Others', 2]],
    nouns: ['water bottle', 'flask', 'tumbler', 'bottle', 'steel bottle'],
    brands: [b('Milton'), b('Nalgene'), b('Hydro Flask', 'Hydroflask')],
    colors: ['black', 'blue', 'green', 'pink', 'silver', 'white', 'purple'],
    details: ['with stickers on it', 'with a dent near the bottom', 'with a straw lid', 'with a carry loop'],
    confusable: ['lunchbox'],
  },
  {
    key: 'umbrella',
    categories: [['Personal items', 5], ['Umbrella', 3], ['Others', 2]],
    nouns: ['umbrella', 'foldable umbrella', 'folding umbrella'],
    brands: [],
    colors: ['black', 'blue', 'red', 'other', 'green'],
    details: ['with a bent spoke', 'in its sleeve', 'with a wooden handle', 'with a hook handle'],
    confusable: [],
  },
  {
    key: 'wallet',
    categories: [['Wallet', 5], ['Personal items', 3], ['Accessories', 2]],
    nouns: ['wallet', 'purse', 'card holder', 'money bag'],
    brands: [b('Levis', "Levi's"), b('Tommy Hilfiger', 'Tommy'), b('Fossil')],
    colors: ['brown', 'black', 'red', 'pink', 'blue'],
    details: ['leather, with a zip', 'with a few cards inside', 'bifold', 'with a coin pocket'],
    confusable: ['idcard'],
  },
  {
    key: 'idcard',
    categories: [['ID card', 5], ['Documents', 3], ['Cards', 2]],
    nouns: ['ID card', 'student ID', 'campus card', 'ID badge', 'student card'],
    brands: [],
    colors: ['blue', 'red', 'black', 'green'],
    details: ['on a lanyard', 'in a plastic holder', 'with a clip', 'on a retractable reel'],
    confusable: ['wallet'],
  },
  {
    key: 'keys',
    categories: [['Keys', 6], ['Personal items', 3]],
    nouns: ['keys', 'key ring', 'keychain', 'bunch of keys', 'set of keys'],
    brands: [],
    colors: ['silver', 'gold', 'other', 'red', 'black'],
    details: ['with a small torch', 'with a rubber duck keychain', 'three keys on a ring', 'with a bottle opener'],
    confusable: [],
  },
  {
    key: 'backpack',
    categories: [['Bag', 6], ['Bags', 2], ['Personal items', 2]],
    nouns: ['backpack', 'rucksack', 'school bag', 'bag', 'laptop bag'],
    brands: [b('Nike'), b('Adidas'), b('JanSport', 'Jansport'), b('Puma'), b('American Tourister', 'AT')],
    colors: ['black', 'blue', 'grey', 'red', 'green', 'other'],
    details: ['with a broken zip', 'with a keychain on the zip', 'with a water bottle pocket', 'with books inside'],
    confusable: ['tote'],
  },
  {
    key: 'tote',
    categories: [['Bag', 6], ['Bags', 2], ['Personal items', 2]],
    nouns: ['tote bag', 'handbag', 'shoulder bag', 'cloth bag'],
    brands: [],
    colors: ['white', 'brown', 'black', 'pink', 'other'],
    details: ['with a printed design', 'with a magnetic button', 'with notebooks inside', 'with long straps'],
    confusable: ['backpack'],
  },
  {
    key: 'jacket',
    categories: [['Clothing', 6], ['Clothes', 2], ['Others', 1]],
    nouns: ['jacket', 'windbreaker', 'raincoat', 'denim jacket'],
    brands: [b('Nike'), b('Adidas'), b('Uniqlo'), b('Puma')],
    colors: ['black', 'blue', 'green', 'grey', 'red', 'brown'],
    details: ['size M', 'with a hood', 'with a torn pocket', 'with a zip front'],
    confusable: ['hoodie'],
  },
  {
    key: 'hoodie',
    categories: [['Clothing', 6], ['Clothes', 2], ['Others', 1]],
    nouns: ['hoodie', 'sweatshirt', 'jumper', 'sweater'],
    brands: [b('Nike'), b('Adidas'), b('H&M', 'HM'), b('Uniqlo')],
    colors: ['black', 'grey', 'blue', 'white', 'red', 'green'],
    details: ['size L', 'with a university logo', 'with a kangaroo pocket', 'with paint stains on the sleeve'],
    confusable: ['jacket'],
  },
  {
    key: 'glasses',
    categories: [['Accessories', 4], ['Eyewear', 3], ['Glasses', 3]],
    nouns: ['glasses', 'spectacles', 'eyeglasses', 'reading glasses'],
    brands: [b('Ray-Ban', 'Rayban'), b('Lenskart'), b('Titan')],
    colors: ['black', 'brown', 'silver', 'gold', 'blue'],
    details: ['in a hard case', 'with thin metal frames', 'with thick frames', 'with a cleaning cloth'],
    confusable: ['sunglasses'],
  },
  {
    key: 'sunglasses',
    categories: [['Accessories', 5], ['Eyewear', 3], ['Glasses', 2]],
    nouns: ['sunglasses', 'shades', 'sunnies'],
    brands: [b('Ray-Ban', 'Rayban'), b('Oakley'), b('Titan')],
    colors: ['black', 'brown', 'gold', 'silver'],
    details: ['in a soft pouch', 'with tinted lenses', 'with aviator frames', 'with a scratched lens'],
    confusable: ['glasses'],
  },
  {
    key: 'notebook',
    categories: [['Stationery', 5], ['Books', 3], ['Notebook', 2]],
    nouns: ['notebook', 'notepad', 'exercise book', 'spiral notebook', 'copy'],
    brands: [b('Classmate'), b('Moleskine'), b('Matador')],
    colors: ['blue', 'black', 'red', 'green', 'brown', 'other'],
    details: ['with lecture notes inside', 'with a torn cover', 'half used', 'with sticky notes'],
    confusable: ['textbook'],
  },
  {
    key: 'textbook',
    categories: [['Books', 6], ['Book', 2], ['Stationery', 2]],
    nouns: ['textbook', 'book', 'course book', 'reference book'],
    brands: [],
    colors: ['blue', 'red', 'white', 'green', 'other'],
    // The subject lives in the detail, which belongs to the item, so both sides share it.
    details: ['for Calculus I, with highlighted pages', 'Organic Chemistry, with a brown paper cover', 'Data Structures, second-hand copy', 'Physics, with notes in the margins', 'Microeconomics, with sticky tabs'],
    confusable: ['notebook'],
  },
  {
    key: 'pencilcase',
    categories: [['Stationery', 7], ['Personal items', 2]],
    nouns: ['pencil case', 'pencil pouch', 'stationery pouch', 'pen case'],
    brands: [b('Faber-Castell', 'Faber Castell'), b('Deli')],
    colors: ['black', 'blue', 'pink', 'grey', 'other'],
    details: ['with pens and a ruler inside', 'with a zip pull charm', 'with a geometry set', 'transparent front'],
    confusable: [],
  },
  {
    key: 'lunchbox',
    categories: [['Personal items', 5], ['Others', 3], ['Kitchen', 1]],
    nouns: ['lunch box', 'tiffin box', 'food container', 'tiffin carrier'],
    brands: [b('Milton'), b('Tupperware')],
    colors: ['blue', 'green', 'red', 'silver', 'pink'],
    details: ['with a spoon inside', 'two compartments', 'in an insulated bag', 'with a cracked lid'],
    confusable: ['bottle'],
  },
];

export type Place = {
  key: string;
  /** Short name for titles and vague locations. */
  short: string;
  /** Ways people write the same spot in the location field. */
  variants: readonly string[];
  /** Nearby or similarly named places that make good hard negatives. */
  confusable: readonly string[];
};

export const PLACES: readonly Place[] = [
  { key: 'library', short: 'the library', variants: ['Central Library', 'Library, 2nd floor reading room', 'library entrance', 'Central Library ground floor near the printers', 'Libary reading room', 'Library study carrels, 3rd floor'], confusable: [] },
  { key: 'cafeteria', short: 'the cafeteria', variants: ['Student Centre cafeteria', 'cafeteria', 'Student Center canteen', 'food court, Student Centre', 'canteen near the juice counter'], confusable: [] },
  { key: 'engineering', short: 'the Engineering Building', variants: ['Engineering Building room 304', 'Engineering Building, 3rd floor corridor', 'Eng building lab 2', 'engineering block lobby'], confusable: ['science'] },
  { key: 'science', short: 'the Science Building', variants: ['Science Building chemistry lab', 'Science Building room 112', 'chem lab, Science Building', 'science block stairs'], confusable: ['engineering'] },
  { key: 'lha', short: 'Lecture Hall A', variants: ['Lecture Hall A', 'Lecture Hall A, back row', 'LH-A', 'lecture theatre A'], confusable: ['lhb'] },
  { key: 'lhb', short: 'Lecture Hall B', variants: ['Lecture Hall B', 'Lecture Hall B, front seats', 'LH-B', 'lecture theatre B'], confusable: ['lha'] },
  { key: 'auditorium', short: 'the auditorium', variants: ['Main Auditorium', 'auditorium hall', 'main auditorium seats near the stage'], confusable: [] },
  { key: 'gym', short: 'the gym', variants: ['Gymnasium', 'gym changing room', 'Sports Complex changing room', 'sports complex basketball court'], confusable: [] },
  { key: 'busstop', short: 'the bus stop', variants: ['campus bus stop', 'shuttle stop near the main gate', 'bus stop outside Main Gate'], confusable: ['maingate'] },
  { key: 'maingate', short: 'the main gate', variants: ['Main Gate', 'main gate security booth', 'near the main gate'], confusable: ['busstop'] },
  { key: 'complab', short: 'the computer lab', variants: ['Computer Lab 2', 'CSE computer lab', 'computer lab, ICT building', 'ICT building lab 2'], confusable: ['engineering'] },
  { key: 'prayer', short: 'the prayer room', variants: ['prayer room, ground floor', 'mosque wudu area', 'prayer hall'], confusable: [] },
  { key: 'hall', short: 'North Hall', variants: ['North Hall common room', 'North Hall TV room', 'dorm common room (North Hall)'], confusable: [] },
  { key: 'parking', short: 'the parking lot', variants: ['parking lot behind Admin Building', 'Admin Building parking', 'car park'], confusable: ['admin'] },
  { key: 'admin', short: 'the Admin Building', variants: ['Admin Building reception', 'Administration Building, accounts office queue', 'admin block lobby'], confusable: ['parking'] },
];

export const TIME_PHRASES = [
  'this morning', 'yesterday afternoon', 'on Monday', 'after the 10am class', 'during the exam',
  'around lunchtime', 'last evening', 'before the lab session', '',
] as const;
