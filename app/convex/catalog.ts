// Store types and deal types: the one taxonomy shared by the app (Pick interests, Filters, chips) and the backend
// (stores.store_type, category_follows, deal_type_follows, alert matching). Plain data, so the app can import it.
// Icons stay in the app (src/lib/interests.ts).

export type StoreTypeEntry = { key: string; label: string; section: string; adult?: boolean };

export const STORE_TYPES: StoreTypeEntry[] = [
  { key: "restaurants", label: "Restaurants", section: "Food & drink" },
  { key: "cafes", label: "Cafes", section: "Food & drink" },
  { key: "boba_tea", label: "Boba & tea", section: "Food & drink" },
  { key: "desserts_bakeries", label: "Desserts & bakeries", section: "Food & drink" },
  { key: "fast_food", label: "Fast food", section: "Food & drink" },
  { key: "juice_smoothies", label: "Juice & smoothies", section: "Food & drink" },
  { key: "food_trucks", label: "Food trucks", section: "Food & drink" },
  { key: "nails", label: "Nails", section: "Beauty & self-care" },
  { key: "hair_barbers", label: "Hair & barbers", section: "Beauty & self-care" },
  { key: "spa_massage", label: "Spa & massage", section: "Beauty & self-care" },
  { key: "lashes_brows", label: "Lashes & brows", section: "Beauty & self-care" },
  { key: "waxing", label: "Waxing", section: "Beauty & self-care" },
  { key: "med_spa", label: "Med spa", section: "Beauty & self-care" },
  { key: "tanning", label: "Tanning", section: "Beauty & self-care" },
  { key: "tattoo_piercing", label: "Tattoo & piercing", section: "Beauty & self-care" },
  { key: "gyms", label: "Gyms", section: "Fitness" },
  { key: "boxing_martial_arts", label: "Boxing & martial arts", section: "Fitness" },
  { key: "yoga_pilates", label: "Yoga & pilates", section: "Fitness" },
  { key: "climbing", label: "Climbing", section: "Fitness" },
  { key: "cycling", label: "Cycling", section: "Fitness" },
  { key: "dance", label: "Dance", section: "Fitness" },
  { key: "swim", label: "Swim", section: "Fitness" },
  { key: "racket_sports", label: "Racket sports", section: "Fitness" },
  { key: "clothing_thrift", label: "Clothing & thrift", section: "Shopping" },
  { key: "shoes_sneakers", label: "Shoes & sneakers", section: "Shopping" },
  { key: "beauty_cosmetics", label: "Beauty & cosmetics", section: "Shopping" },
  { key: "electronics", label: "Electronics", section: "Shopping" },
  { key: "jewelry", label: "Jewelry", section: "Shopping" },
  { key: "books", label: "Books", section: "Shopping" },
  { key: "records", label: "Records", section: "Shopping" },
  { key: "art_supplies", label: "Art supplies", section: "Shopping" },
  { key: "furniture_home", label: "Furniture & home", section: "Shopping" },
  { key: "sporting_goods", label: "Sporting goods", section: "Shopping" },
  { key: "toys_games", label: "Toys & games", section: "Shopping" },
  { key: "plants_flowers", label: "Plants & flowers", section: "Shopping" },
  { key: "phones_repair", label: "Phones & repair", section: "Shopping" },
  { key: "bags_accessories", label: "Bags & accessories", section: "Shopping" },
  { key: "movies", label: "Movies", section: "Fun" },
  { key: "live_music", label: "Live music", section: "Fun" },
  { key: "arcades_bowling", label: "Arcades & bowling", section: "Fun" },
  { key: "comedy_theater", label: "Comedy & theater", section: "Fun" },
  { key: "museums", label: "Museums", section: "Fun" },
  { key: "escape_rooms", label: "Escape rooms", section: "Fun" },
  { key: "mini_golf", label: "Mini golf", section: "Fun" },
  { key: "theme_parks", label: "Theme parks", section: "Fun" },
  { key: "pharmacy", label: "Pharmacy", section: "Health" },
  { key: "dental", label: "Dental", section: "Health" },
  { key: "eye_care_glasses", label: "Eye care & glasses", section: "Health" },
  { key: "chiro_physio", label: "Chiro & physio", section: "Health" },
  { key: "grocery", label: "Grocery", section: "Everyday" },
  { key: "convenience_stores", label: "Convenience stores", section: "Everyday" },
  { key: "laundry_dry_cleaning", label: "Laundry & dry cleaning", section: "Everyday" },
  { key: "printing_shipping", label: "Printing & shipping", section: "Everyday" },
  { key: "tailoring", label: "Tailoring", section: "Everyday" },
  { key: "moving_storage", label: "Moving & storage", section: "Everyday" },
  { key: "coworking", label: "Coworking", section: "Everyday" },
  { key: "banks", label: "Banks", section: "Everyday" },
  { key: "gas", label: "Gas", section: "Auto" },
  { key: "car_wash", label: "Car wash", section: "Auto" },
  { key: "auto_repair", label: "Auto repair", section: "Auto" },
  { key: "parking", label: "Parking", section: "Auto" },
  { key: "pet_stores", label: "Pet stores", section: "Pets" },
  { key: "grooming", label: "Grooming", section: "Pets" },
  { key: "vets", label: "Vets", section: "Pets" },
  { key: "hotels_staycations", label: "Hotels & staycations", section: "Stays" },
  { key: "bars_breweries", label: "Bars & breweries", section: "Nightlife", adult: true },
  { key: "clubs", label: "Clubs", section: "Nightlife", adult: true },
  { key: "lounges_hookah", label: "Lounges & hookah", section: "Nightlife", adult: true },
  { key: "karaoke", label: "Karaoke", section: "Nightlife", adult: true },
  { key: "liquor_stores", label: "Liquor stores", section: "21+ shops", adult: true },
  { key: "smoke_vape", label: "Smoke & vape", section: "21+ shops", adult: true },
  { key: "dispensaries", label: "Dispensaries", section: "21+ shops", adult: true },
];

export const DEAL_TYPES = [
  { key: "bogo", label: "BOGO" },
  { key: "percent_off", label: "% off" },
  { key: "free", label: "Free stuff" },
  { key: "student", label: "Student deals" },
  { key: "happy_hour", label: "Happy hour" },
  { key: "late_night", label: "Late night" },
  { key: "new_opening", label: "New openings" },
  { key: "event", label: "Upcoming events" },
] as const;

export type DealTypeKey = (typeof DEAL_TYPES)[number]["key"];

const BY_KEY = new Map(STORE_TYPES.map((t) => [t.key, t]));
const BY_LABEL = new Map(STORE_TYPES.map((t) => [t.label, t]));

export function storeType(key: string | undefined | null): StoreTypeEntry | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function storeTypeByLabel(label: string): StoreTypeEntry | undefined {
  return BY_LABEL.get(label);
}

export function isAdultStoreType(key: string | undefined | null): boolean {
  return Boolean(storeType(key)?.adult);
}

export function dealTypeByLabel(label: string) {
  return DEAL_TYPES.find((t) => t.label === label);
}

export function dealTypeLabel(key: string) {
  return DEAL_TYPES.find((t) => t.key === key)?.label;
}

// Google Maps category (Shop.category, e.g. "Bubble tea store") → store type. First match wins, so the more
// specific patterns come first.
const GOOGLE_CATEGORY_RULES: [RegExp, string][] = [
  [/bubble tea|boba|tea house|tea store/i, "boba_tea"],
  [/juice|smoothie|acai/i, "juice_smoothies"],
  [/dessert|bakery|ice cream|frozen yogurt|donut|patisserie|cake|gelato|creperie/i, "desserts_bakeries"],
  [/food truck/i, "food_trucks"],
  [/fast food|hamburger|chicken wings|fried chicken|sandwich shop|hot dog|taco stand/i, "fast_food"],
  [/coffee|caf[eé]|espresso/i, "cafes"],
  [/restaurant|pizza|diner|bistro|grill|eatery|ramen|sushi|noodle|steak|bbq|barbecue|kitchen/i, "restaurants"],
  [/brewery|bar\b|pub|wine bar|cocktail|tavern|beer/i, "bars_breweries"],
  [/night ?club|dance club/i, "clubs"],
  [/hookah|lounge/i, "lounges_hookah"],
  [/karaoke/i, "karaoke"],
  [/liquor/i, "liquor_stores"],
  [/vape|smoke shop|tobacco/i, "smoke_vape"],
  [/cannabis|dispensary|marijuana/i, "dispensaries"],
  [/nail/i, "nails"],
  [/barber|hair/i, "hair_barbers"],
  [/med ?spa|botox|aesthetic/i, "med_spa"],
  [/spa|massage/i, "spa_massage"],
  [/lash|brow/i, "lashes_brows"],
  [/wax/i, "waxing"],
  [/tanning/i, "tanning"],
  [/tattoo|piercing/i, "tattoo_piercing"],
  [/boxing|martial arts|karate|jiu|kickboxing|muay thai|mma/i, "boxing_martial_arts"],
  [/yoga|pilates/i, "yoga_pilates"],
  [/climbing|bouldering/i, "climbing"],
  [/cycling|spin/i, "cycling"],
  [/dance/i, "dance"],
  [/swim|pool/i, "swim"],
  [/tennis|pickleball|badminton|squash|racquet/i, "racket_sports"],
  [/gym|fitness|crossfit|health club/i, "gyms"],
  [/thrift|clothing|boutique|apparel|fashion|vintage/i, "clothing_thrift"],
  [/shoe|sneaker/i, "shoes_sneakers"],
  [/cosmetic|beauty supply|makeup|skin care/i, "beauty_cosmetics"],
  [/cell phone|phone repair|mobile phone/i, "phones_repair"],
  [/electronics|computer|camera/i, "electronics"],
  [/jewel/i, "jewelry"],
  [/book/i, "books"],
  [/record store|music store|vinyl/i, "records"],
  [/art supply|craft/i, "art_supplies"],
  [/furniture|home goods|home decor/i, "furniture_home"],
  [/sporting goods|sports store|outdoor/i, "sporting_goods"],
  [/toy|game store|hobby/i, "toys_games"],
  [/florist|plant|nursery|garden/i, "plants_flowers"],
  [/bag|handbag|accessor|luggage/i, "bags_accessories"],
  [/movie|cinema|theater.*movie/i, "movies"],
  [/live music|concert|music venue/i, "live_music"],
  [/arcade|bowling/i, "arcades_bowling"],
  [/comedy|theater|theatre/i, "comedy_theater"],
  [/museum|gallery/i, "museums"],
  [/escape room/i, "escape_rooms"],
  [/mini(ature)? golf/i, "mini_golf"],
  [/amusement|theme park/i, "theme_parks"],
  [/pharmacy|drugstore/i, "pharmacy"],
  [/dentist|dental/i, "dental"],
  [/optometrist|optician|eye care|eyewear/i, "eye_care_glasses"],
  [/chiropract|physical therap|physiotherap/i, "chiro_physio"],
  [/grocery|supermarket|market/i, "grocery"],
  [/convenience/i, "convenience_stores"],
  [/laundr|dry clean/i, "laundry_dry_cleaning"],
  [/print|shipping|mail/i, "printing_shipping"],
  [/tailor|alteration/i, "tailoring"],
  [/moving|storage/i, "moving_storage"],
  [/coworking|office space/i, "coworking"],
  [/bank|credit union/i, "banks"],
  [/gas station/i, "gas"],
  [/car wash/i, "car_wash"],
  [/auto|mechanic|tire|oil change/i, "auto_repair"],
  [/parking/i, "parking"],
  [/pet groom/i, "grooming"],
  [/veterinar|animal hospital/i, "vets"],
  [/pet/i, "pet_stores"],
  [/hotel|motel|inn\b|resort/i, "hotels_staycations"],
];

// The API's coarse deal category, for stores Google Maps didn't categorise.
const DEAL_CATEGORY_FALLBACK: Record<string, string> = {
  food: "restaurants",
  drink: "cafes",
  retail: "clothing_thrift",
  entertainment: "movies",
  beauty: "hair_barbers",
  fitness: "gyms",
};

export function storeTypeFor(googleCategory?: string | null, dealCategory?: string | null): string | undefined {
  if (googleCategory) {
    const hit = GOOGLE_CATEGORY_RULES.find(([re]) => re.test(googleCategory));
    if (hit) return hit[1];
  }
  return dealCategory ? DEAL_CATEGORY_FALLBACK[dealCategory] : undefined;
}
