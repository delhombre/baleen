# Périmètre produit

## Positionnement

Baleen aide à transformer des pages produit consultées dans Chrome en fiches comparables. Il conserve les
preuves visibles, les structure avec le fournisseur choisi et laisse `unknown` lorsqu'une information
n'est pas disponible.

## Parcours principal

1. Ouvrir une page produit et le side panel Baleen.
2. Créer une collection et capturer la page.
3. Répéter la capture sur d'autres pages.
4. Consulter les fiches en liste ou les comparer dans un tableau.
5. Copier ou télécharger la collection en Markdown, CSV ou JSON.

## Fonctionnalités de la v1

- Capture JSON-LD `schema.org/Product` lorsqu'elle est disponible.
- Repli vers les preuves pertinentes et visibles du DOM, dans un budget borné.
- Normalisation par Anthropic ou Groq, sélectionné par l'utilisateur avec sa propre clé API.
- Collections locales avec création, renommage, suppression et sélection.
- Comparaison des attributs et des spécifications entre les fiches.
- Exports Markdown, CSV et JSON avec provenance.
- Page Options avec clé masquée et action unique **Enregistrer et vérifier**.

## Garanties

- Une information absente reste `unknown`; Baleen ne la déduit pas.
- Chaque fiche conserve son URL, son titre de page, sa date de capture et sa méthode d'extraction.
- Les fiches, collections et clés restent dans le profil Chrome local.
- Les données produit nécessaires à la normalisation sont envoyées directement au fournisseur sélectionné.
- Aucun compte, backend, synchronisation ou OAuth n'est inclus dans la v1.

## Limites

- Une capture qualifie au plus un produit. Une page ambiguë est signalée au lieu d'être choisie arbitrairement.
- La qualité dépend des informations visibles et de la structure de chaque site.
- Le support cible Chrome et Chromium avec Manifest V3 et le Side Panel.
- Firefox, Safari, suivi de prix, captures d'écran, recommandations et collaboration sont hors périmètre.
