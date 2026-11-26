// The ready-made areas of the workshop: the places of the practical demonstrations (2 km) and the areas of
// the mini hackathon (2 or 3 km). The boxes are exactly the ones the notebooks send (sr_client.area_around),
// so the service recognises an image it has already made and returns it at once, free.
// Made from tools/demos/places.py and tools/hackathon/areas.py of github.com/adb-sr/sr-client.
const READY = [
  {"name": "ADB headquarters, Mandaluyong", "note": "Dense city: office towers, malls, residential blocks", "lat": 14.5878, "lon": 121.0585, "km": 2, "date": "2026-04-15", "bbox": [121.049218, 14.578817, 121.067782, 14.596783], "set": "demo"},
  {"name": "DHSUD office, Quezon City", "note": "City: government offices, tree-lined streets, housing", "lat": 14.6447, "lon": 121.0514, "km": 2, "date": "2026-04-15", "bbox": [121.042115, 14.635717, 121.060685, 14.653683], "set": "demo"},
  {"name": "PhilSA office, Quezon City", "note": "City by the Marikina river: towers, subdivisions, riverside", "lat": 14.6096, "lon": 121.0803, "km": 2, "date": "2026-04-15", "bbox": [121.071017, 14.600617, 121.089583, 14.618583], "set": "demo"},
  {"name": "Cebu City and Mandaue", "note": "Dense city by the coast: port, warehouses, small houses", "lat": 10.33, "lon": 123.92, "km": 2, "date": "2026-03-20", "bbox": [123.910869, 10.321017, 123.929131, 10.338983], "set": "demo"},
  {"name": "Nueva Ecija rice farms", "note": "Rice fields, villages and farm-to-market roads", "lat": 15.5784, "lon": 120.9726, "km": 2, "date": "2026-03-15", "bbox": [120.963274, 15.569417, 120.981926, 15.587383], "set": "demo"},
  {"name": "Bangkok, Thailand", "note": "Old city on the Chao Phraya: Grand Palace, Sanam Luang, dense housing, river", "lat": 13.75, "lon": 100.4915, "km": 2, "date": "2026-01-15", "bbox": [100.482252, 13.741017, 100.500748, 13.758983], "set": "demo"},
  {"name": "Phnom Penh, Cambodia", "note": "City centre: Central Market, Royal Palace, riverfront, dense blocks", "lat": 11.565, "lon": 104.925, "km": 2, "date": "2026-02-01", "bbox": [104.915831, 11.556017, 104.934169, 11.573983], "set": "demo"},
  {"name": "Tondo and Baseco, Manila", "note": "Dense city, port, informal settlements", "lat": 14.596, "lon": 120.962, "km": 3, "date": "2026-03-15", "bbox": [120.948076, 14.582525, 120.975924, 14.609475], "set": "hackathon"},
  {"name": "Payatas, Quezon City", "note": "Informal settlements at the city edge", "lat": 14.713, "lon": 121.1, "km": 3, "date": "2026-03-15", "bbox": [121.086069, 14.699525, 121.113931, 14.726475], "set": "hackathon"},
  {"name": "Manila South", "note": "Dense city, informal settlements", "lat": 14.556, "lon": 121.0136, "km": 2, "date": "2025-06-01", "bbox": [121.004319, 14.547017, 121.022881, 14.564983], "set": "hackathon"},
  {"name": "San Jose del Monte, Bulacan", "note": "City edge, new housing estates", "lat": 14.8139, "lon": 121.0453, "km": 3, "date": "2026-03-15", "bbox": [121.031362, 14.800425, 121.059238, 14.827375], "set": "hackathon"},
  {"name": "Marikina River, Marikina City", "note": "River and flood plain in a city", "lat": 14.635, "lon": 121.09, "km": 3, "date": "2026-03-15", "bbox": [121.076073, 14.621525, 121.103927, 14.648475], "set": "hackathon"},
  {"name": "Rodriguez and San Mateo, Rizal", "note": "Quarries at the forest edge", "lat": 14.745, "lon": 121.15, "km": 3, "date": "2026-03-15", "bbox": [121.136066, 14.731525, 121.163934, 14.758475], "set": "hackathon"},
  {"name": "Hagonoy, Bulacan", "note": "Fishponds and coast", "lat": 14.834, "lon": 120.733, "km": 3, "date": "2026-03-15", "bbox": [120.719061, 14.820525, 120.746939, 14.847475], "set": "hackathon"},
  {"name": "Science City of Muñoz, Nueva Ecija", "note": "Small rice farms, farm roads", "lat": 15.715, "lon": 120.905, "km": 3, "date": "2026-03-15", "bbox": [120.891002, 15.701525, 120.918998, 15.728475], "set": "hackathon"},
  {"name": "New Clark City, Tarlac", "note": "Large construction sites, new roads", "lat": 15.345, "lon": 120.53, "km": 3, "date": "2026-03-15", "bbox": [120.516027, 15.331525, 120.543973, 15.358475], "set": "hackathon"},
  {"name": "Tacloban City, Leyte", "note": "Coastal city rebuilt after a typhoon", "lat": 11.2433, "lon": 125.004, "km": 3, "date": "2026-04-15", "bbox": [124.990262, 11.229825, 125.017738, 11.256775], "set": "hackathon"},
  {"name": "Hanoi, Red River banks", "note": "City edge: villages, rice fields, building sites", "lat": 21.0787, "lon": 105.7822, "km": 3, "date": "2025-11-15", "bbox": [105.767759, 21.065225, 105.796641, 21.092175], "set": "hackathon"},
  {"name": "Phnom Penh, southern edge", "note": "City growing into wetland", "lat": 11.5, "lon": 104.92, "km": 3, "date": "2026-02-01", "bbox": [104.906249, 11.486525, 104.933751, 11.513475], "set": "hackathon"},
  {"name": "Bangkok, old city on the Chao Phraya", "note": "Dense historic city, river, temples", "lat": 13.75, "lon": 100.4915, "km": 3, "date": "2026-01-15", "bbox": [100.477628, 13.736525, 100.505372, 13.763475], "set": "hackathon"},
  {"name": "North Jakarta coast", "note": "Dense coastal city, port", "lat": -6.115, "lon": 106.8, "km": 3, "date": "2026-08-15", "bbox": [106.786448, -6.128475, 106.813552, -6.101525], "set": "hackathon"},
  {"name": "Dhaka, eastern edge", "note": "City growing into flood plain", "lat": 23.78, "lon": 90.45, "km": 3, "date": "2025-11-15", "bbox": [90.435275, 23.766525, 90.464725, 23.793475], "set": "hackathon"},
];
