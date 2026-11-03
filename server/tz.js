// Salon-local time for all date maths. Imported first by every entry point.
// SALON_TZ is used because hosts such as Vercel reserve the TZ variable.
process.env.TZ = process.env.SALON_TZ || 'Asia/Kolkata';
