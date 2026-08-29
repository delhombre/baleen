# Vérification manuelle

Cette checklist complète la suite automatique avec un essai dans Chrome installé, une clé temporaire et
des pages produit réelles. Ne jamais noter une clé, un en-tête d'autorisation ou du contenu privé.

## Préparer l'essai

1. Vérifier Node.js `>=24 <27` et pnpm `11.24.0`.
2. Installer les dépendances avec `pnpm install --frozen-lockfile`.
3. Construire avec `pnpm build`.
4. Dans `chrome://extensions`, activer le mode développeur et charger le dossier produit par le build.
5. Ouvrir **Options**, puis le side panel depuis l'interface Chrome.
6. Vérifier l'état **Aucune collection** et l'absence de bouton de capture orphelin.

## Options et fournisseurs

1. Vérifier qu'Anthropic est le fournisseur par défaut.
2. Saisir une clé temporaire, cliquer sur **Enregistrer et vérifier** et vérifier le succès masqué.
3. Vérifier une erreur de clé refusée ou de réseau avec une action de reprise, si le profil le permet.
4. Sélectionner Groq et attendre la fin du changement de fournisseur.
5. Saisir une clé Groq distincte, l'enregistrer et vérifier le succès.
6. Supprimer les deux clés à la fin de l'essai.

## Capture et comparaison

1. Créer une collection, ouvrir une page produit et cliquer sur **Capturer cette page produit**.
2. Vérifier les états de capture, de normalisation, la fiche et sa provenance.
3. Répéter sur deux autres pages et vérifier la persistance après rechargement du side panel.
4. Vérifier qu'une information absente reste `unknown` et qu'une fiche partielle n'invente rien.
5. Ouvrir **Comparaison** et vérifier les colonnes, les spécifications et les cellules `unknown`.
6. Provoquer une page non produit, vérifier le message public et utiliser **Réessayer**.

## Exports et nettoyage

1. Copier un export Markdown et vérifier le tableau, la provenance et les `unknown`.
2. Télécharger un CSV puis un JSON et vérifier leurs colonnes, leur structure et l'absence de clé.
3. Vérifier que les actions d'export sont bloquées pour une collection vide ou pendant une opération.
4. Supprimer la clé de test et remettre le profil Chrome dans son état initial.

## Résultat

Consigner la date, le navigateur, les fournisseurs essayés et un résultat par section. Les tests réels non
exécutés faute de clé doivent rester explicitement marqués comme non exécutés.
