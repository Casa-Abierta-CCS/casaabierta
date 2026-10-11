// Revisa los servicios de "Asignaciones" programados para mañana y envía un
// recordatorio push a cada voluntario con un rol asignado. Se ejecuta a diario
// vía GitHub Actions (.github/workflows/recordatorios.yml).
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const ROLES_LABELS = {
    predicador: 'Predicador / Pastor',
    lider_alabanza: 'Líder de Alabanza',
    musicos: 'Músicos',
    sonido: 'Sonido',
    multimedia: 'Multimedia / Pantallas',
    bienvenida: 'Bienvenida',
    logistica: 'Logística',
    ninos: 'Escuela / Niños'
};

const TOKEN_INVALIDO = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
]);

// "Mañana" en horario de Venezuela (UTC-4), sin depender de la zona horaria del runner
function fechaManana() {
    const horaVenezuela = new Date(Date.now() - 4 * 60 * 60 * 1000);
    horaVenezuela.setUTCDate(horaVenezuela.getUTCDate() + 1);
    return horaVenezuela.toISOString().split('T')[0];
}

async function main() {
    const fechaObjetivo = fechaManana();
    console.log(`Buscando servicios para: ${fechaObjetivo}`);

    const snap = await db.collection('asignaciones_servicios').where('fecha', '==', fechaObjetivo).get();

    if (snap.empty) {
        console.log('No hay servicios programados para mañana. Nada que enviar.');
        return;
    }

    // uid -> [{ titulo, rol }]
    const tareasPorUsuario = new Map();

    snap.forEach(doc => {
        const servicio = doc.data();
        const asignaciones = servicio.asignaciones || {};
        Object.entries(asignaciones).forEach(([rolId, uids]) => {
            (uids || []).forEach(uid => {
                if (!tareasPorUsuario.has(uid)) tareasPorUsuario.set(uid, []);
                tareasPorUsuario.get(uid).push({
                    titulo: servicio.titulo || 'Servicio',
                    rol: ROLES_LABELS[rolId] || rolId
                });
            });
        });
    });

    if (tareasPorUsuario.size === 0) {
        console.log('Hay servicio(s) mañana pero nadie tiene un rol asignado todavía.');
        return;
    }

    let enviados = 0;
    let sinNotificacionesActivadas = 0;

    for (const [uid, tareas] of tareasPorUsuario) {
        const userDoc = await db.collection('users').doc(uid).get();
        const tokens = (userDoc.data() || {}).fcmTokens || [];

        if (tokens.length === 0) {
            sinNotificacionesActivadas++;
            continue;
        }

        const cuerpo = tareas.map(t => `${t.rol} — ${t.titulo}`).join('\n');

        const respuesta = await admin.messaging().sendEachForMulticast({
            tokens,
            data: {
                title: '🔔 Recordatorio de servicio mañana',
                body: cuerpo
            },
            android: {
                // Prioridad alta: evita que Android retrase la entrega por ahorro
                // de batería (Doze/App Standby), especialmente en MIUI/Xiaomi.
                priority: 'high'
            }
        });

        console.log(`  → uid=${uid}: ${respuesta.successCount} exitoso(s), ${respuesta.failureCount} fallido(s) de ${tokens.length} token(s)`);

        // Limpiar tokens vencidos/desinstalados para no acumular basura
        const tokensInvalidos = [];
        respuesta.responses.forEach((r, i) => {
            if (!r.success) {
                console.log(`    token ${tokens[i].slice(0, 20)}...: ${r.error?.code} — ${r.error?.message}`);
            }
            if (!r.success && TOKEN_INVALIDO.has(r.error?.code)) {
                tokensInvalidos.push(tokens[i]);
            }
        });
        if (tokensInvalidos.length > 0) {
            await db.collection('users').doc(uid).update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensInvalidos)
            });
        }

        enviados++;
    }

    console.log(`Recordatorios enviados a ${enviados} voluntario(s). ${sinNotificacionesActivadas} con tarea asignada pero sin notificaciones activadas.`);
}

main().catch(err => {
    console.error('Error enviando recordatorios:', err);
    process.exit(1);
});
