# Décisions techniques

Ces décisions décrivent les invariants de Baleen. Elles restent valables tant
qu'une évolution produit ne demande pas explicitement de les revoir.

## 1. Partir de preuves visibles

Baleen structure uniquement ce qui est trouvé dans la page produit ouverte. Une
valeur absente ou ambiguë reste `unknown` au lieu d'être déduite ou inventée.
Chaque fiche conserve une provenance quand une URL et une date sont disponibles.

## 2. Limiter l'extraction

L'extraction privilégie les données JSON-LD puis le texte visible du DOM dans une
limite déterministe. Cette borne protège la lisibilité, évite les pages entières
et rend les résultats comparables entre captures.

## 3. Garder un coeur indépendant

Les règles de normalisation et de comparaison restent indépendantes de Chrome,
de React et des SDK fournisseurs. Les adaptateurs gèrent le navigateur, le
stockage local et les appels réseau, tandis que l'interface présente des états
explicites.

## 4. Utiliser le BYOK explicite

La v1 prend en charge Anthropic et Groq avec une clé fournie par l'utilisateur.
L'option choisie est enregistrée puis vérifiée avant une capture. Aucun faux
OAuth ni fournisseur implicite ne masque l'état réel de la configuration.

## 5. Garder les données locales par défaut

Les collections et la clé restent dans le profil local du navigateur. Baleen ne
gère ni compte ni serveur applicatif. Les données produit sont envoyées
directement au fournisseur choisi uniquement lorsqu'une normalisation est
demandée.

## 6. Rendre l'incertitude lisible

Les fiches, tableaux et exports distinguent les faits connus, les champs
inconnus, les éléments partiels et les erreurs de traitement. Un résultat
partiel ne devient pas une réussite silencieuse.

## 7. Préserver la sécurité des secrets

Les clés ne sont jamais affichées dans l'interface après saisie, ajoutées aux
fiches, exports ou journaux. Les erreurs destinées à l'utilisateur décrivent
l'action de récupération sans révéler la réponse brute d'un fournisseur.

## 8. Tester hors ligne et vérifier dans Chrome

Les tests unitaires utilisent des réponses et pages locales déterministes. La
vérification du projet couvre les contrats du coeur et du paquet d'extension,
puis un scénario Chrome réel confirme la configuration, la capture et la
lecture des résultats.
