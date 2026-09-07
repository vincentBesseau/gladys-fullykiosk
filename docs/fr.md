# Fully Kiosk Browser

Découvrez vos tablettes Android [Fully Kiosk Browser](https://www.fully-kiosk.com/)
à partir des rapports de statut qu'elles publient déjà via MQTT (adresse IP,
batterie, page en cours, mode kiosque...), puis pilotez-les - écran on/off,
verrouillage kiosque, chargement d'une URL, synthèse vocale, redémarrage,
reboot... - via leur API REST HTTP locale.

## Fonctionnement

- **Découverte : MQTT.** Fully Kiosk peut publier périodiquement un rapport
  JSON « deviceInfo » vers un broker MQTT (Paramètres > Autres paramètres >
  Paramètres MQTT, dans l'application Fully Kiosk). Cette intégration se
  connecte au même broker et s'abonne à tout ce qui se trouve sous un préfixe
  de topic (`fully/#` par défaut) : tout message JSON qui ressemble à un
  rapport deviceInfo (il porte un identifiant d'appareil) est récupéré, et la
  tablette apparaît dans Gladys.
- **Pilotage : HTTP local.** Chaque commande (écran on/off, chargement d'URL,
  redémarrage de l'app...) est envoyée directement à l'API REST de la
  tablette (`http://<ip-tablette>:2323/?cmd=...`), que Fully Kiosk protège
  par un mot de passe défini par tablette (Paramètres > Autres paramètres >
  Administration à distance > Mot de passe d'administration à distance).
  Enregistrez ce mot de passe une fois la tablette ajoutée à Gladys, via
  l'action **Définir le mot de passe API REST d'une tablette** - pas besoin
  de taper son IP, choisissez-la dans la liste déroulante.

## Broker MQTT : dédié ou existant

Le champ **Broker MQTT** de la configuration propose deux modes :

- **Lancer un broker dédié (recommandé)** : cette intégration démarre et
  gère son propre broker Mosquitto (un sous-conteneur), avec un identifiant
  et un mot de passe générés automatiquement. Rien d'autre à installer.
  Utilisez l'action **Afficher les identifiants du broker dédié** (dans
  l'onglet Configuration) pour récupérer l'adresse, l'identifiant et le mot
  de passe à saisir dans les paramètres MQTT de chaque tablette.
- **Se connecter à un broker existant** : si vous avez déjà un serveur MQTT
  (Mosquitto, EMQX...), renseignez son hôte/port/identifiants dans les
  champs prévus à cet effet.

## Configuration

1. Choisissez le mode de broker (ci-dessus). Avec le mode dédié, enregistrez
   d'abord la configuration une fois pour que le broker démarre et que les
   identifiants soient générés, puis récupérez-les via l'action **Afficher
   les identifiants du broker dédié**.
2. Dans l'application Fully Kiosk de chaque tablette, activez **MQTT**
   (Paramètres > Autres paramètres > Paramètres MQTT) et pointez-la vers
   l'adresse/les identifiants du broker choisi à l'étape 1 - le topic exact
   que vous définissez là-bas importe peu tant qu'il commence par le préfixe
   configuré ici (`fully` par défaut).
3. Toujours dans chaque tablette, activez **l'administration à distance**
   (Paramètres > Autres paramètres > Administration à distance) et notez le
   **mot de passe d'administration à distance** défini - l'API REST de Fully
   Kiosk en a besoin pour chaque commande.
4. Enregistrez, puis lancez **Rafraîchir la liste des tablettes** (ou ouvrez
   l'onglet Découverte) une fois qu'une tablette a envoyé son premier rapport
   MQTT, et ajoutez-la à Gladys.
5. Lancez l'action **Définir le mot de passe API REST d'une tablette**,
   choisissez la tablette dans la liste déroulante (seules les tablettes déjà
   ajoutées y apparaissent), puis renseignez son mot de passe d'administration
   à distance (et un port REST personnalisé si ce n'est pas 2323 par défaut).
   Répétez pour chaque tablette.

## Pourquoi une action plutôt qu'un champ de configuration

Les intégrations externes Gladys n'exposent qu'un seul formulaire de
configuration global, commun à toute l'intégration - il n'existe pas d'écran
de paramètres par appareil intégré. En revanche, une **action** du manifeste
peut définir son propre mini-formulaire, y compris une liste déroulante
pré-remplie avec les appareils déjà créés par l'intégration - c'est
exactement ce qu'utilise l'action **Définir le mot de passe API REST d'une
tablette**, pour éviter de devoir taper ou copier une adresse IP à la main.
Le mot de passe est stocké par identifiant Gladys stable de la tablette, pas
par IP, donc il survit à un changement de bail DHCP contrairement à une
liste indexée par IP.

## Actions disponibles par tablette

| Fonctionnalité            | Effet                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| Écran                     | Allume/éteint l'écran de la tablette                              |
| Verrouillage kiosque      | Active/désactive le mode kiosque (verrouillage) de Fully Kiosk    |
| Économiseur d'écran       | Démarre/arrête l'économiseur d'écran                              |
| Page en cours             | Lecture seule : l'URL/l'app actuellement au premier plan          |
| Charger une URL           | Écriture d'une URL pour la charger immédiatement                  |
| Synthèse vocale           | Écriture d'un texte pour le faire dire par la tablette            |
| Redémarrer l'app          | Redémarre l'application Fully Kiosk                               |
| Recharger l'URL de départ | Recharge l'URL de démarrage configurée                            |
| Redémarrer l'appareil     | Redémarre toute la tablette (nécessite Device Owner/root Android) |
| Vider le cache            | Vide le cache du navigateur                                       |
| Quitter l'app             | Quitte l'application Fully Kiosk                                  |
| Batterie / Charge         | Lecture seule, quand la tablette la remonte                       |

## Limites

- Réseau local uniquement : pas de compte cloud, rien ne fonctionne si la
  tablette ou le broker MQTT est injoignable.
- L'action « Définir le mot de passe API REST d'une tablette » affiche le
  mot de passe en clair pendant la saisie - Gladys ne masque pas les champs
  de type `secret` à l'intérieur du formulaire d'une action (seulement dans
  le formulaire de Configuration principal), donc cette intégration utilise
  ici un champ texte simple plutôt qu'un masquage cassé. La valeur reste
  stockée de façon sécurisée côté serveur et n'est jamais réaffichée
  ensuite.
- Le mode broker dédié publie le port du broker sur le réseau local de votre
  serveur Gladys - toute personne sur ce réseau disposant des identifiants
  générés peut s'y connecter. Sans problème sur un réseau domestique, à
  garder en tête sur un réseau partagé/non fiable.
- Le fichier de mots de passe du broker dédié doit être lisible par tous
  (Gladys exécute chaque sous-conteneur avec toutes les capacités Linux
  supprimées, donc cette intégration ne peut pas en faire un `chown` vers
  l'utilisateur propre du broker) - Mosquitto 2.0.18 se contente d'avertir à
  ce sujet ; une future version de Mosquitto pourrait refuser de démarrer
  dans ce cas, ce qui nécessiterait de revoir la version de l'image
  Mosquitto figée par cette intégration.
- Pas de retour en temps réel sur l'effet d'une commande : le tableau de bord
  ne reflète l'état réel d'une tablette qu'après son prochain rapport MQTT
  programmé (ou une interrogation manuelle).
- Les noms exacts des champs MQTT/REST de Fully Kiosk ont varié selon les
  versions de l'application et ne sont pas formellement versionnés ; si un
  champ (par ex. la page en cours) ne se remplit jamais, vérifiez la charge
  utile brute (journalisée en niveau debug, `LOG_LEVEL=debug`) au regard de
  votre version de Fully Kiosk.
- « Redémarrer l'appareil » et certaines commandes de paramètres nécessitent
  que la tablette soit Device Owner (ou rootée) - sinon Fully Kiosk rejette
  la commande, indépendamment de cette intégration.
