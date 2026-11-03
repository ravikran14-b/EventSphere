db = db.getSiblingDB('eventsphere');

// Clean and seed the 'events' collection for event.ravi-devops.space
db.events.drop();

db.events.insertMany([
  {
    eventId: "EVT-1001",
    title: "A.R. Rahman Live in Concert - Symphony of Lights",
    artist: "A.R. Rahman",
    category: "Music Concert",
    venue: "Gachibowli Outdoor Stadium, Hyderabad",
    eventDate: ISODate("2026-12-15T18:30:00Z"),
    status: "ACTIVE",
    imageUrl: "/images/ar-rahman.jpg",
    tiers: [
      { tierCode: "VIP", tierName: "VIP Fan Pit", price: 4999, totalSeats: 200, availableSeats: 200 },
      { tierCode: "GOLD", tierName: "Gold Lounge", price: 2499, totalSeats: 1000, availableSeats: 1000 },
      { tierCode: "SILVER", tierName: "Silver Gallery", price: 999, totalSeats: 3000, availableSeats: 3000 }
    ],
    createdAt: new Date()
  },
  {
    eventId: "EVT-1002",
    title: "Coldplay: Music of the Spheres Tour",
    artist: "Coldplay",
    category: "International Rock",
    venue: "DY Patil Stadium, Mumbai",
    eventDate: ISODate("2027-01-20T19:00:00Z"),
    status: "ACTIVE",
    imageUrl: "/images/coldplay.jpg",
    tiers: [
      { tierCode: "VIP", tierName: "Infinity Floor Standing", price: 6500, totalSeats: 500, availableSeats: 500 },
      { tierCode: "GOLD", tierName: "Lower Bowl Seating", price: 3500, totalSeats: 2000, availableSeats: 2000 },
      { tierCode: "SILVER", tierName: "Upper Tier Seating", price: 1500, totalSeats: 5000, availableSeats: 5000 }
    ],
    createdAt: new Date()
  },
  {
    eventId: "EVT-1003",
    title: "Sunburn Arena Electronic Festival",
    artist: "Martin Garrix",
    category: "EDM Festival",
    venue: "YMCA Grounds, Chennai",
    eventDate: ISODate("2026-11-28T17:00:00Z"),
    status: "ACTIVE",
    imageUrl: "/images/sunburn.jpg",
    tiers: [
      { tierCode: "VIP", tierName: "VVIP Elevated Deck", price: 3999, totalSeats: 300, availableSeats: 300 },
      { tierCode: "GA", tierName: "General Admission", price: 1299, totalSeats: 4000, availableSeats: 4000 }
    ],
    createdAt: new Date()
  }
]);

db.events.createIndex({ eventId: 1 }, { unique: true });

// Prepare the 'users' collection & unique indexes for user.ravi-devops.space
db.users.drop();
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ username: 1 }, { unique: true });

print("EventSphere MongoDB schema & master data loaded successfully.");
