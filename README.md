# Baleen

Baleen est une extension Chrome qui capture les informations visibles d'une page produit, les structure
en fiche et compare plusieurs fiches. Les informations absentes restent `unknown`.

## Fonctionnalités

- Capture JSON-LD ou texte visible du DOM, dans un périmètre borné.
- Collections locales pour organiser les fiches.
- Comparaison des produits dans un tableau où les inconnues restent explicites.
- Exports Markdown, CSV et JSON avec provenance.
- Normalisation par Anthropic ou Groq, au choix de l'utilisateur.

## Installer en développement

### Prérequis

- Node.js `>=24 <27`.
- pnpm `11.24.0`.
- Chrome ou Chromium avec le support des extensions Manifest V3 et du Side Panel.

### Construire et charger l'extension

```sh
pnpm install --frozen-lockfile
pnpm build
```

1. Ouvrir `chrome://extensions`.
2. Activer le mode développeur.
3. Choisir **Charger l'extension non empaquetée** et sélectionner le dossier généré par `pnpm build`.
4. Ouvrir **Options**, puis le side panel de Baleen depuis Chrome.

## Configurer un fournisseur

La v1 est BYOK: vous fournissez votre propre clé API. Dans **Options**, choisissez Anthropic ou Groq,
ouvrez le lien officiel de création de clé, saisissez la clé et cliquez sur **Enregistrer et vérifier**.

- [Créer une clé Anthropic](https://console.anthropic.com/settings/keys)
- [Créer une clé Groq](https://console.groq.com/keys)

La clé reste dans `chrome.storage.local` et n'est jamais affichée, journalisée, ajoutée à une fiche ou
incluse dans un export. Pendant une capture, les données produit sont envoyées directement au fournisseur
sélectionné pour normalisation. Baleen n'ajoute ni compte, ni backend, ni OAuth en v1.

## Utiliser Baleen

1. Créer une collection dans le side panel.
2. Ouvrir une page produit HTTP(S), puis cliquer sur **Capturer cette page produit**.
3. Répéter la capture sur d'autres pages pour remplir la collection.
4. Utiliser **Liste** pour les fiches ou **Comparaison** pour aligner leurs attributs.
5. Ouvrir **Exporter la collection** pour copier ou télécharger un export.

Une fiche affiche sa provenance et ses `unknown`. Une valeur absente n'est jamais devinée. Les erreurs
indiquent l'action de reprise disponible; le nom du fournisseur apparaît lorsqu'il est connu.

## Vérifier le projet

```sh
pnpm verify
```

La commande vérifie le formatage, le lint, le typage strict, les tests unitaires, le build, le manifeste et
les tests de bout en bout. Les données de test et les réponses fournisseur sont locales et déterministes; aucune clé utilisateur
n'est nécessaire. Ce contrôle automatique ne remplace pas un essai réel dans Chrome avec une clé et une
page produit réelle.

## Architecture

Le cœur métier reste indépendant de React, de Chrome et des SDK fournisseur. Des adaptateurs bornent la
capture DOM, le stockage local et les appels Anthropic ou Groq. Les entrypoints rendent les états français,
les collections, la comparaison, les options et les exports. La provenance accompagne chaque fiche depuis
la capture jusqu'aux trois formats d'export.

## Limites de la v1

- Les fiches, collections et clés restent locales au profil Chrome.
- Une capture qualifie au plus un produit; une page ambiguë devient une erreur visible.
- Le support vise Chrome et Chromium; Firefox et Safari ne sont pas ciblés.
- L'extraction dépend des preuves visibles et ne garantit pas chaque site.
- Il n'y a pas de compte, synchronisation, suivi de prix, capture d'écran ou recommandation.

## Documentation

- [Périmètre produit](docs/product-scope.md)
- [Architecture détaillée](docs/architecture.md)
- [Vérification manuelle](docs/qa/manual-check.md)
- [Politique de sécurité](SECURITY.md)

## Licence

Baleen est un dépôt propriétaire. La redistribution et la réutilisation ne sont pas autorisées sans accord
écrit. Voir [LICENSE](LICENSE).
