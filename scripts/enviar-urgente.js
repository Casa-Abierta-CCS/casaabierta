// Revisa si el "Recordatorio Urgente" de Configuracion cambio desde la ultima
// vez, y si es asi, le avisa por push a todos los voluntarios con
// notificaciones activadas. Se ejecuta cada ~15 minutos via GitHub Actions
// (.github/workflows/urgente.yml).
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const TOKEN_INVALIDO = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
]);

async function main() {
    const configRef = db.collection('configuracion').doc('general');
    const configDoc = await configRef.get();
    const config = configDoc.data() || {};

    const actual = (config.recordatorioUrgente || '').trim();
    const yaNotificado = config.recordatorioUrgenteNotificado || '';

    if (actual === yaNotificado) {
        console.log('Sin cambios en el Recordatorio Urgente. Nada que enviar.');
        return;
    }

    if (!actual) {
        console.log('El Recordatorio Urgente se vació. Se actualiza el marcador sin enviar notificación.');
        await configRef.update({ recordatorioUrgenteNotificado: '' });
        return;
    }

    console.log(`Nuevo Recordatorio Urgente detectado: "${actual}"`);

    const usuariosSnap = await db.collection('users').get();
    const tokenOwners = [];
    usuariosSnap.forEach(doc => {
        (doc.data().fcmTokens || []).forEach(token => tokenOwners.push({ uid: doc.id, token }));
    });

    if (tokenOwners.length === 0) {
        console.log('Nadie tiene notificaciones activadas todavía. Se marca como notificado igual.');
        await configRef.update({ recordatorioUrgenteNotificado: actual });
        return;
    }

    const tokens = tokenOwners.map(o => o.token);

    const respuesta = await admin.messaging().sendEachForMulticast({
        tokens,
        data: {
            title: '🚨 Recordatorio urgente',
            body: actual
        },
        android: { priority: 'high' }
    });

    console.log(`Enviado a ${respuesta.successCount} de ${tokens.length} token(s).`);

    // Limpiar tokens vencidos/desinstalados, agrupados por usuario dueño
    const tokensInvalidosPorUsuario = new Map();
    respuesta.responses.forEach((r, i) => {
        if (!r.success) {
            console.log(`  token ${tokenOwners[i].token.slice(0, 20)}... (uid=${tokenOwners[i].uid}): ${r.error?.code} — ${r.error?.message}`);
        }
        if (!r.success && TOKEN_INVALIDO.has(r.error?.code)) {
            const { uid, token } = tokenOwners[i];
            if (!tokensInvalidosPorUsuario.has(uid)) tokensInvalidosPorUsuario.set(uid, []);
            tokensInvalidosPorUsuario.get(uid).push(token);
        }
    });

    for (const [uid, invalidos] of tokensInvalidosPorUsuario) {
        await db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidos)
        });
    }

    await configRef.update({ recordatorioUrgenteNotificado: actual });
}

main().catch(err => {
    console.error('Error enviando el recordatorio urgente:', err);
    process.exit(1);
});
