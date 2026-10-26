# Pure Energie

Intégration non officielle, sans lien avec Pure Energie ni NET2GRID. Elle lit
le **lecteur de compteur de Pure Energie** (un SmartBridge NET2GRID, comme le
SBWF3102, branché sur le port P1 de votre compteur électrique) par son API
HTTP locale : sans cloud, sans compte, sans clé, rien n'est envoyé à
l'appareil que des demandes de lecture (GET), une lecture toutes les 30
secondes au plus.

**Jamais testé avec un vrai appareil** : elle a été écrite à partir de la
bibliothèque Python gridnet (celle qu'utilise l'intégration Pure Energie de
Home Assistant). Vos retours sont les bienvenus.

## Ce que vous obtenez

Un appareil, nommé d'après le modèle et la fin de l'identifiant du lecteur
(`Pure Energie SBWF3102 3795`) :

| Fonction (nom dans Gladys) | Type                 |
| -------------------------- | -------------------- |
| Power                      | capteur d'énergie, W |
| Consumption index          | index d'énergie, kWh |
| Injection index (kWh)      | simple capteur       |

- La **puissance** est signée : négative quand votre logement injecte
  (panneaux solaires).
- L'**index de consommation** alimente le suivi énergétique de Gladys :
  Gladys en déduit la consommation et son coût. Il est publié au plus une
  fois par minute et vérifié d'abord : une valeur à 0 n'est jamais envoyée ;
  toute baisse, même de 1 Wh, ou tout saut plus grand que ce que votre
  logement a pu consommer (la « puissance plausible la plus haute » de la
  configuration, 100 kW par défaut, sur le temps écoulé depuis la dernière
  valeur) est **retenu** (la dernière valeur acceptée est renvoyée) et
  affiché dans l'état de l'intégration. Si c'est juste (un nouveau
  compteur), cliquez deux fois sur **Accepter l'index retenu** (voir
  Boutons). Enregistrer la configuration ne l'accepte jamais.
- L'**injection** n'entre jamais dans le suivi énergétique (elle serait
  facturée comme consommation) : un simple capteur, jamais envoyé à 0.
- Un index donné dans une autre unité que Wh ou kWh, ou sans unité, n'est pas
  envoyé (l'état le dit) : un index n'est jamais deviné.
- Le gaz n'est pas lu.

## Seulement des valeurs fraîches

Le lecteur date ses valeurs. Une lecture dont la date n'a pas avancé depuis
la précédente n'envoie rien : une vieille valeur n'est jamais envoyée comme
une nouvelle, ni après un redémarrage de l'intégration, ni après un
redémarrage de Gladys (la date est gardée dans `/data`). Quand la date n'a
pas avancé depuis 2 heures, l'état le dit. Sans date, une empreinte des
valeurs en tient lieu.

## Identité

L'appareil est repéré par l'identifiant que le lecteur donne sur sa page
`/info` (`84df:0c11:9999:3795`, gardé sous forme de ses chiffres
hexadécimaux). Chaque lecture demande l'identifiant avant et après les
valeurs : si un autre identifiant répond entre-temps, ou si l'identifiant est
illisible, rien de cette lecture n'est publié. Si un autre lecteur répond à
l'adresse, il a son propre appareil (à créer dans Découverte) ; l'ancien
appareil garde son historique.

## Installation

1. Trouvez l'adresse IP du lecteur dans votre box, et donnez-lui de
   préférence une adresse fixe.
2. Dans Gladys, ouvrez l'intégration, saisissez cette adresse et
   enregistrez.
3. Dans l'onglet **Découverte**, créez l'appareil.

## Boutons

- **Tester la connexion** : lit le lecteur une fois quand une lecture est due
  (jamais plus d'une toutes les 30 secondes), sinon donne la dernière
  lecture : son identifiant, la puissance, les index de consommation et
  d'injection.
- **Accepter l'index retenu**, en deux clics. Le premier clic affiche
  l'index retenu et ne prend rien. Le second, de quelques secondes à 5
  minutes plus tard, prend ce que le premier a affiché, seulement si la
  valeur retenue n'a pas changé depuis (au-delà de ce que le compteur a pu
  mesurer entre-temps). Un saut est alors compté d'un coup comme
  consommation ; une baisse ne facture rien.

## En cas de problème

- **Injoignable ou mauvaise réponse** : nouvel essai après 30 secondes, puis
  doublé jusqu'à 10 minutes.
- **L'appareil demande d'attendre (429) ou échoue (5xx)** : lectures en pause
  de 1 minute à 6 heures, y compris après un redémarrage.
- **Le fichier d'état dans `/data` est illisible** : il est laissé tel quel
  (jamais écrasé) et l'état le dit ; un index retenu ou la date des
  dernières valeurs peuvent alors être oubliés.

## Confidentialité

Tout reste sur votre réseau. L'intégration n'envoie que des requêtes GET à
l'adresse que vous avez saisie.
