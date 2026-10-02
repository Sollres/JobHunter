#!/bin/bash
# Double-clic pour ouvrir Job Hunter en application de bureau (Mac). À rendre exécutable une fois : chmod +x lancer-app.command
cd "$(dirname "$0")"
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate jobhunter
[ -d node_modules ] || npm install
npm run app
