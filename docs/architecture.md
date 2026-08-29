# Architecture

Baleen est une extension Chrome Manifest V3 composée d'un service worker, d'un content script, d'un side
panel et d'une page Options.

## Flux de données

1. Le content script lit les preuves visibles de la page active à la demande.
2. L'extraction privilégie JSON-LD `schema.org/Product`, puis utilise un repli DOM borné.
3. Le worker lit la clé du fournisseur choisi dans le stockage local et transmet les preuves à son adaptateur.
4. Le coeur valide la réponse, matérialise les absences en `unknown` et produit une fiche typée.
5. Le contrôleur persiste les collections localement; la vue compare et exporte les fiches validées.

## Frontières

Le coeur contient les schémas, l'extraction, la normalisation, les collections, la comparaison et les
exports. Il reste indépendant de React, de Chrome et des SDK fournisseur. Les adaptateurs portent les
frontières DOM, runtime, stockage et API. Les composants UI rendent les états et les actions en français.

## Fournisseurs et confidentialité

Anthropic et Groq implémentent le même port de normalisation, avec leurs modèles et leurs erreurs propres.
La clé choisie est lue côté worker et n'entre ni dans le DOM, ni dans les fiches, ni dans les exports. Baleen
ne fournit pas de proxy serveur: la capture nécessaire à la normalisation part directement vers le
fournisseur sélectionné.

## Validation et preuves

Les réponses externes sont traitées comme des données non fiables et validées avant persistance. La
provenance accompagne la fiche jusqu'aux exports. Les tests unitaires vérifient les interfaces publiques et les
tests d'intégration utilisent des données locales et des réponses fournisseur déterministes.
