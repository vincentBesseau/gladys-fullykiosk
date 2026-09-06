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
  Renseignez ce mot de passe pour chaque tablette dans la configuration de
  cette intégration.

## Configuration

1. Dans l'application Fully Kiosk de chaque tablette, activez **MQTT**
   (Paramètres > Autres paramètres > Paramètres MQTT) et pointez-la vers le
   même broker que vous renseignerez ci-dessous - le topic exact que vous
   définissez là-bas importe peu tant qu'il commence par le préfixe configuré
   ici (`fully` par défaut).
2. Toujours dans chaque tablette, activez **l'administration à distance**
   (Paramètres > Autres paramètres > Administration à distance) et notez le
   **mot de passe d'administration à distance** défini - l'API REST de Fully
   Kiosk en a besoin pour chaque commande.
3. Ouvrez l'onglet **Configuration** de cette intégration et renseignez votre
   broker MQTT (hôte, port, identifiants le cas échéant).
4. Dans le champ **Tablettes**, ajoutez une ligne par tablette :
   `ip:mot_de_passe` (ou `ip:port:mot_de_passe` si le port REST d'une
   tablette n'est pas le port par défaut 2323). L'IP doit correspondre à
   celle annoncée par la tablette via MQTT - une réservation DHCP statique
   par tablette est recommandée.
5. Enregistrez, puis lancez **Rafraîchir la liste des tablettes** (ou ouvrez
   l'onglet Découverte) une fois qu'une tablette a envoyé son premier rapport
   MQTT.

## Pourquoi pas un écran de configuration par tablette

Les intégrations externes Gladys n'exposent qu'un seul formulaire de
configuration global, commun à toute l'intégration - il n'existe pas d'écran
de paramètres par appareil que l'utilisateur pourrait remplir. Le champ
**Tablettes** ci-dessus (une ligne `ip:mot_de_passe` par tablette) est le
substitut le plus proche disponible, le même principe que le champ « IPs
connues » de `gladys-sonos` pour des données propres à chaque cible.

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
