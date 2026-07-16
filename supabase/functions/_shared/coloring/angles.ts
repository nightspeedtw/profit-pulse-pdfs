// Angle library for coloring-book title diversity.
// Given a category_key, returns an ordered list of English "angle" strings
// used to build a unique title. Falls back to GENERIC_ANGLES.

export const GENERIC_ANGLES: string[] = [
  "Cute",
  "Fierce",
  "Baby",
  "Giant",
  "Magical",
  "Underwater",
  "Space",
  "Winter",
  "Party",
  "Jungle",
  "Rainbow",
  "Superhero",
  "Rescue",
  "Adventure",
  "Bedtime",
  "Birthday",
];

const CATEGORY_ANGLES: Record<string, string[]> = {
  dinosaurs: ["Cute Dinosaurs", "Fierce Dinosaurs", "Baby Dinos", "Dinos in Space", "Rainbow Dinos", "Jurassic Adventure", "Underwater Dinos", "Superhero Dinos"],
  vehicles: ["Race Cars", "Monster Trucks", "Fire & Rescue", "Construction Trucks", "Police Cars", "Space Rockets", "Speed Boats", "Big Rigs"],
  animals: ["Cute Animals", "Wild Safari", "Jungle Friends", "Farm Buddies", "Baby Animals", "Arctic Animals", "Rainforest Animals", "Desert Animals"],
  unicorns: ["Cute Unicorns", "Magical Unicorns", "Baby Unicorns", "Rainbow Unicorns", "Princess Unicorns", "Starlight Unicorns", "Unicorn Party", "Unicorn Bakery"],
  princess: ["Fairy Tale Princess", "Warrior Princess", "Ice Princess", "Garden Princess", "Ocean Princess", "Star Princess", "Princess Ball", "Princess Adventure"],
  ocean: ["Cute Sea Creatures", "Deep Sea Monsters", "Mermaid World", "Coral Reef", "Whale Family", "Baby Sharks", "Underwater Kingdom", "Tropical Fish"],
  space: ["Baby Astronauts", "Alien Friends", "Planet Party", "Rocket Adventure", "Space Explorers", "Galaxy Pets", "Moon Base", "Solar System"],
  robots: ["Cute Robots", "Battle Robots", "Baby Bots", "Chef Robots", "Space Robots", "Rescue Robots", "Rainbow Robots", "Farm Robots"],
  fairy: ["Garden Fairies", "Woodland Fairies", "Sea Fairies", "Snow Fairies", "Rainbow Fairies", "Baby Fairies", "Fairy Party", "Star Fairies"],
  dragons: ["Cute Dragons", "Baby Dragons", "Fierce Dragons", "Ice Dragons", "Fire Dragons", "Rainbow Dragons", "Dragon Riders", "Cloud Dragons"],
  cats: ["Cute Kittens", "Space Cats", "Ninja Cats", "Princess Cats", "Rainbow Cats", "Chef Cats", "Superhero Cats", "Bakery Cats"],
  dogs: ["Puppy Party", "Rescue Puppies", "Superhero Dogs", "Farm Dogs", "Baby Puppies", "Chef Dogs", "Space Dogs", "Rainbow Puppies"],
  food: ["Cute Cupcakes", "Happy Fruits", "Pizza Party", "Ice Cream World", "Bakery Friends", "Sushi Buddies", "Candy Land", "Breakfast Bunch"],
  holidays: ["Christmas Magic", "Halloween Party", "Easter Bunnies", "Valentine's Hearts", "Thanksgiving Fun", "Birthday Bash", "New Year Party", "Summer Fun"],
};

export function anglesFor(categoryKey: string): string[] {
  const key = String(categoryKey ?? "").toLowerCase();
  const scoped = CATEGORY_ANGLES[key];
  if (scoped && scoped.length) return scoped;
  return GENERIC_ANGLES;
}
