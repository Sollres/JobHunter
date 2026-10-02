#!/bin/bash
# Double-clic pour lancer l'application (Mac). À rendre exécutable une fois : chmod +x lancer.command
cd "$(dirname "$0")"
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate jobhunter
streamlit run app.py
