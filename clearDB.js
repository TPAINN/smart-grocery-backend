require('dotenv').config(); // Προστέθηκε για να διαβάζει το .env

const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
const mongoose = require('mongoose');
const Product = require('./models/Product');

const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';

mongoose.connect(dbURI)
    .then(async () => {
        console.log("📦 Συνδέθηκε στη βάση δεδομένων (Atlas)... Διαγραφή όλων των προϊόντων!");
        await Product.deleteMany({});
        console.log("✅ Η βάση καθάρισε πλήρως! Είναι σαν καινούργια.");
        process.exit(0);
    })
    .catch(err => {
        console.error("❌ Αποτυχία σύνδεσης:", err);
        process.exit(1);
    });