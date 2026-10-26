// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a free text of the device: only our own words, error codes and the
// values we checked (ids and models passed the patterns of
// src/net2grid/model.js).
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  // Rounded first: 59.99 s is told "1 min", never "60 s".
  if (Math.round(ms / 1000) >= 60) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/net2grid/client.js and src/app.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  redirect: {
    en: 'redirect refused (is it the meter reader?)',
    fr: 'redirection refusée (est-ce bien le lecteur de compteur ?)',
  },
  not_found: {
    en: 'no NET2GRID API at this address (is it a Pure Energie meter reader?)',
    fr: 'pas d’API NET2GRID à cette adresse (est-ce bien un lecteur de compteur Pure Energie ?)',
  },
  server: { en: 'error of the device', fr: 'erreur de l’appareil' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an answer of a NET2GRID meter reader',
    fr: 'ce n’est pas une réponse d’un lecteur de compteur NET2GRID',
  },
  not_ok: {
    en: 'the device says its meter reading is not ok',
    fr: 'l’appareil indique que sa lecture du compteur n’est pas bonne',
  },
  no_identity: {
    en: 'its id cannot be read, nothing published',
    fr: 'son identifiant est illisible, rien publié',
  },
  identity_changed: {
    en: 'another device answered during the read, nothing published',
    fr: 'un autre appareil a répondu pendant la lecture, rien publié',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const kwh = (value) => Math.round(value * 1000) / 1000;
/** The device as shown: its model and id (both checked). */
const name = (info) => `${info.model ?? 'NET2GRID'} ${info.id}`;

/** `ago` ms ago, or undefined for a read made by this click. */
const when = (ago) =>
  ago === undefined
    ? { en: 'Read now', fr: 'Lu à l’instant' }
    : { en: `Last read ${delay(ago).en} ago`, fr: `Dernière lecture il y a ${delay(ago).fr}` };

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

/** The next read. */
const nextRead = (next) => ({
  en: ` Next read in ${delay(next).en}.`,
  fr: ` Prochaine lecture dans ${delay(next).fr}.`,
});

export const T = {
  incomplete: {
    en: 'Enter the address of your Pure Energie meter reader (its IP address on your network, e.g. 192.168.1.60).',
    fr: 'Saisissez l’adresse de votre lecteur de compteur Pure Energie (son adresse IP sur votre réseau, ex. 192.168.1.60).',
  },
  badAddress: {
    en: 'The address is not valid: enter the IP address or the host name of the meter reader, with an optional port (e.g. 192.168.1.60).',
    fr: 'L’adresse n’est pas valide : saisissez l’adresse IP ou le nom d’hôte du lecteur de compteur, avec un port éventuel (ex. 192.168.1.60).',
  },
  /** `notes`: { en, fr } texts added after the failure (an index held back). */
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Pure Energie meter reader at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `Le lecteur de compteur Pure Energie à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Pure Energie meter reader at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
        fr: `Le lecteur de compteur Pure Energie à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  waiting: (address, notes = []) =>
    withNotes(
      {
        en: `Waiting for the first answer of the Pure Energie meter reader at ${address}.`,
        fr: `En attente de la première réponse du lecteur de compteur Pure Energie à l’adresse ${address}.`,
      },
      notes,
    ),
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, info, notes = []) =>
    withNotes(
      {
        en: `Connected to the Pure Energie meter reader ${name(info)} (${address}).`,
        fr: `Connecté au lecteur de compteur Pure Energie ${name(info)} (${address}).`,
      },
      notes,
    ),
  notes: {
    noDevice: {
      en: 'Create its device from the "Discover" tab to receive its values.',
      fr: 'Créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.',
    },
    otherDevice: (id) => ({
      en: `Another device answers at this address (id ${id}): create its own device from the "Discover" tab; the previous one keeps its history and gets no values while it is away.`,
      fr: `Un autre appareil répond à cette adresse (identifiant ${id}) : créez son propre appareil depuis l’onglet « Découverte » ; le précédent garde son historique et ne reçoit pas de valeurs tant qu’il est absent.`,
    }),
    frozen: (after) => ({
      en: `The device has not given new values for ${delay(after).en} or more (its time of reading does not move): nothing is sent until it does.`,
      fr: `L’appareil n’a pas donné de nouvelles valeurs depuis ${delay(after).fr} ou plus (son heure de lecture n’avance pas) : rien n’est envoyé tant qu’elle n’avance pas.`,
    }),
    storeUnreadable: {
      en: 'The state file of the integration in /data cannot be read: it is left as it is (never written over), so a held index or the date of the last values may be forgotten. Remove pure-energie-state.json from the /data volume to start afresh.',
      fr: 'Le fichier d’état de l’intégration dans /data est illisible : il est laissé tel quel (jamais écrasé), donc un index retenu ou la date des dernières valeurs peuvent être oubliés. Supprimez pure-energie-state.json du volume /data pour repartir de zéro.',
    },
    unitUnknown: {
      en: 'The device gives an index in a unit this integration does not read (Wh or kWh expected): the index is not sent.',
      fr: 'L’appareil donne un index dans une unité que cette intégration ne lit pas (Wh ou kWh attendus) : l’index n’est pas envoyé.',
    },
    noImport: {
      en: 'The device gives no consumption index (is its cable on the P1 port of the meter?): power only.',
      fr: 'L’appareil ne donne pas d’index de consommation (son câble est-il sur le port P1 du compteur ?) : puissance seulement.',
    },
    /** The index held, `{ direction, from, to }`. */
    held: ({ direction, from, to }) =>
      direction === 'down'
        ? {
            en: `Consumption index held back (the last accepted value is sent again): it dropped from ${kwh(from)} to ${kwh(to)} kWh. If it is right (a new meter), click "Accept the held index" twice in the configuration of the integration (the first click shows it, the second accepts it). Saving the configuration accepts nothing.`,
            fr: `Index de consommation retenu (la dernière valeur acceptée est renvoyée) : il a baissé de ${kwh(from)} à ${kwh(to)} kWh. Si c’est juste (un nouveau compteur), cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic l’affiche, le second l’accepte). Enregistrer la configuration n’accepte rien.`,
          }
        : {
            en: `Consumption index held back (the last accepted value is sent again): it jumped from ${kwh(from)} to ${kwh(to)} kWh (${kwh(to - from)} kWh would be counted at once as consumption). If it is right, click "Accept the held index" twice in the configuration of the integration (the first click shows it, the second accepts it, plus what the meter may measure in between). Saving the configuration accepts nothing.`,
            fr: `Index de consommation retenu (la dernière valeur acceptée est renvoyée) : il a sauté de ${kwh(from)} à ${kwh(to)} kWh (${kwh(to - from)} kWh seraient comptés d’un coup comme consommation). Si c’est juste, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic l’affiche, le second l’accepte, plus ce que le compteur a pu mesurer entre-temps). Enregistrer la configuration n’accepte rien.`,
          },
  },
  accept: {
    nothing: {
      en: 'No consumption index is held back: nothing to accept.',
      fr: 'Aucun index de consommation n’est retenu : rien à accepter.',
    },
    /** The first click: what a second click would accept. */
    confirm: ({ direction, from, to }, within, margin) => {
      const what =
        direction === 'down'
          ? {
              en: `from ${kwh(from)} down to ${kwh(to)} kWh (0 kWh counted)`,
              fr: `de ${kwh(from)} à ${kwh(to)} kWh (0 kWh compté)`,
            }
          : {
              en: `from ${kwh(from)} to ${kwh(to)} kWh (${kwh(to - from)} kWh counted at once as consumption)`,
              fr: `de ${kwh(from)} à ${kwh(to)} kWh (${kwh(to - from)} kWh comptés d’un coup comme consommation)`,
            };
      return {
        en: `A second click accepts this value, plus what the meter may measure between the two clicks (at most ${kwh(margin)} kWh): ${what.en}. Click "Accept the held index" again, after a few seconds and within ${delay(within).en}, to accept it; accept only if this energy was real.`,
        fr: `Un second clic accepte cette valeur, plus ce que le compteur a pu mesurer entre les deux clics (au plus ${kwh(margin)} kWh) : ${what.fr}. Cliquez de nouveau sur « Accepter l’index retenu », après quelques secondes et dans les ${delay(within).fr}, pour l’accepter ; n’acceptez que si cette énergie est réelle.`,
      };
    },
    done: (to) => ({
      en: `Accepted: index ${kwh(to)} kWh, sent with the next new reading.`,
      fr: `Accepté : index ${kwh(to)} kWh, envoyé avec la prochaine nouvelle lecture.`,
    }),
    changed: {
      en: 'Not accepted: the held value changed since the first click. Click again to see it.',
      fr: 'Non accepté : la valeur retenue a changé depuis le premier clic. Cliquez de nouveau pour la voir.',
    },
  },
  test: {
    /** The outcome of a read, `ago` ms ago (undefined: made by this click), the next in `next` ms. */
    reading: (info, v, ago, next) => {
      const power = v.power === undefined ? '?' : `${Math.round(v.power)} W`;
      const index = (held) =>
        v.index === undefined ? '?' : `${kwh(v.index)} kWh${v.held ? held : ''}`;
      const injection = v.injection === undefined ? '?' : `${kwh(v.injection)} kWh`;
      return {
        en: `${when(ago).en}: ${name(info)}, power ${power}, consumption index ${index(' (held back)')}, injection ${injection}${v.frozen ? ' (values not renewed by the device)' : ''}.${nextRead(next).en}`,
        fr: `${when(ago).fr} : ${name(info)}, puissance ${power}, index de consommation ${index(' (retenu)')}, injection ${injection}${v.frozen ? ' (valeurs non renouvelées par l’appareil)' : ''}.${nextRead(next).fr}`,
      };
    },
    failed: (address, err, ago, next) => ({
      en: `${when(ago).en}: the meter reader at ${address} could not be read (${reason(err).en}).${nextRead(next).en}`,
      fr: `${when(ago).fr} : le lecteur de compteur à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}).${nextRead(next).fr}`,
    }),
    notYet: (next, interval) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one every ${delay(interval).en}).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une toutes les ${delay(interval).fr}).`,
    }),
    slow: {
      en: 'The meter reader is slow to answer: look at the integration status in a minute.',
      fr: 'Le lecteur de compteur tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
