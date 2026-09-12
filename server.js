const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const path = require('path');

const app = express();

// Configuration de la base de données MySQL (dynamique pour Render ou Local)
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sasp_mdt',
    ssl: { rejectUnauthorized: false }
});

db.connect(err => {
    if (err) {
        console.error('Erreur MySQL :', err.message);
    } else {
        console.log('Connecté à la base de données MySQL.');
        // Création automatique de la table si elle n'existe pas
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS membres_staff (
                id INT AUTO_INCREMENT PRIMARY KEY,
                matricule VARCHAR(50) NOT NULL UNIQUE,
                nom_complet VARCHAR(100) NOT NULL,
                discord_id VARCHAR(50),
                licence_compte VARCHAR(100),
                licence_personnage VARCHAR(100),
                armes TEXT,
                derniere_verification DATE,
                statut VARCHAR(50)
            )
        `;
        db.query(createTableQuery, (createErr) => {
            if (createErr) console.error("Erreur création table :", createErr.message);
            else console.log("Table membres_staff vérifiée/créée avec succès.");
        });
    }
});

// Middlewares d'analyse des requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration sécurisée des sessions
app.use(session({
    secret: 'sasp_mdt_secret_key_12345',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 heures
}));

// Servir les fichiers statiques sans donner index.html par défaut
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Mot de passe unique pour accéder au site
const MOT_DE_PASSE_STAFF = "SASPLegacy";

// Middleware de protection
function checkAuth(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: "Non authentifié" });
    }
    return res.redirect('/login.html');
}

// Route de connexion (POST)
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === MOT_DE_PASSE_STAFF) {
        req.session.isAuthenticated = true;
        req.session.save((err) => {
            if (err) {
                console.error("Erreur sauvegarde session :", err);
                return res.status(500).json({ success: false, message: "Erreur serveur session" });
            }
            return res.json({ success: true });
        });
    } else {
        return res.status(401).json({ success: false, message: 'Mot de passe incorrect.' });
    }
});

// Route de déconnexion
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

// Page de connexion (GET)
app.get('/login.html', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Route Racine et Dashboard (protégées)
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API : Rechercher ou lister les membres avec statuts, dates et armes
app.get('/api/membres/search', checkAuth, (req, res) => {
    const { q } = req.query;
    let query = `SELECT id, matricule, nom_complet, discord_id, licence_compte, licence_personnage, armes, derniere_verification, statut FROM membres_staff ORDER BY CAST(matricule AS UNSIGNED) ASC`;
    let params = [];

    if (q && q.trim() !== '') {
        query = `
            SELECT id, matricule, nom_complet, discord_id, licence_compte, licence_personnage, armes, derniere_verification, statut FROM membres_staff 
            WHERE nom_complet LIKE ? OR matricule LIKE ? OR discord_id LIKE ? OR licence_compte LIKE ? OR licence_personnage LIKE ? OR armes LIKE ? OR statut LIKE ?
            ORDER BY CAST(matricule AS UNSIGNED) ASC`;
        const searchVal = `%${q.trim()}%`;
        params = [searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal];
    }

    db.query(query, params, (err, results) => {
        if (err) {
            console.error("ERREUR SQL :", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// API : Ajouter ou Mettre à jour un membre
app.post('/api/membres', checkAuth, (req, res) => {
    let { discord_id, nom_complet, matricule, licence_compte, licence_personnage, armes, derniere_verification, statut } = req.body;

    if (!derniere_verification || derniere_verification.trim() === '') {
        derniere_verification = null;
    }

    const query = `
        INSERT INTO membres_staff (discord_id, nom_complet, matricule, licence_compte, licence_personnage, armes, derniere_verification, statut)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
        discord_id = VALUES(discord_id),
        nom_complet = VALUES(nom_complet), 
        licence_compte = VALUES(licence_compte), 
        licence_personnage = VALUES(licence_personnage), 
        armes = VALUES(armes),
        derniere_verification = VALUES(derniere_verification),
        statut = VALUES(statut)
    `;

    db.query(query, [discord_id, nom_complet, matricule, licence_compte, licence_personnage, armes, derniere_verification, statut || 'SASP'], (err) => {
        if (err) {
            console.error("ERREUR INSERT SQL :", err.message);
            return res.status(500).json({ success: false, message: 'Erreur SQL : ' + err.message });
        }
        res.json({ success: true, message: 'Membre enregistré avec succès !' });
    });
});

// API : Supprimer un membre
app.delete('/api/membres/:id', checkAuth, (req, res) => {
    db.query(`DELETE FROM membres_staff WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Membre supprimé avec succès !' });
    });
});

// Lancement du serveur sur le port dynamique de Render ou 3000 en local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));