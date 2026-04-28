import os
import json
import joblib
import datetime
import urllib.request
import urllib.error
import numpy as np
import pandas as pd
from flask import Flask, render_template, request, jsonify
from tensorflow.keras.models import load_model

app = Flask(__name__)

# ---------------------------------------------------------
# CONSTANTS & CONFIG
# ---------------------------------------------------------
API_KEY = "FN3RL3GMGMSCSG4QE9WJJDNLN"
BASE_URL = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/"

# Attempt to load assets gracefully
MODEL_PATH = "flood_model.h5"
SCALER_PATH = "scaler.pkl"
FEATURES_PATH = "features.pkl"

model = None
scaler = None
feature_cols = None
window_size = 14  # Default fallback

if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH) and os.path.exists(FEATURES_PATH):
    print("[INIT] Loading Deep Learning Model...")
    model = load_model(MODEL_PATH)
    # Dynamically extract the exact sequence window size the model requires
    window_size = model.input_shape[1] 
    
    print("[INIT] Loading Scaler & Feature Mappings...")
    scaler = joblib.load(SCALER_PATH)
    feature_cols = joblib.load(FEATURES_PATH)
    print(f"Loaded successfully! Model expects window={window_size}, features={len(feature_cols)}")
else:
    print("[WARNING] Model files not found! Please run the last cell of FYP2.ipynb to export them.")


# ---------------------------------------------------------
# ROUTES
# ---------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/forecast', methods=['POST'])
def get_forecast():
    if model is None:
        return jsonify({"error": "Flood Model is not loaded. Please run FYP2.ipynb export cell first."}), 500
        
    data = request.json
    location = data.get("location", "Malaysia")
    
    # 1. Calculate the robust API timeline fetch window
    # We need historical memory past days = window_size
    today = datetime.date.today()
    start_date = today - datetime.timedelta(days=window_size)
    end_date = today + datetime.timedelta(days=15)
    
    # Clean the location for URL
    safe_loc = urllib.parse.quote(location)
    
    # Visual Crossing JSON endpoint requesting full sequence
    api_url = f"{BASE_URL}{safe_loc}/{start_date}/{end_date}?unitGroup=metric&include=days&key={API_KEY}&contentType=json"
    
    print(f"Fetching from: {api_url}")
    
    try:
        with urllib.request.urlopen(api_url) as response:
            weather_data = json.loads(response.read().decode())
    except Exception as e:
        return jsonify({"error": f"Failed to fetch Weather API: {str(e)}"}), 500

    # 2. Map API data to Deep Learning Features
    days_data = weather_data.get('days', [])
    if len(days_data) < window_size + 1:
         return jsonify({"error": "Weather API returned insufficient timeline data."}), 500
         
    # Build a DataFrame of the raw API payload
    df_api = pd.DataFrame(days_data)
    
    # We must construct a completely zeroed generic dataframe with exactly our feature_cols dimension
    df_model_ready = pd.DataFrame(0, index=np.arange(len(df_api)), columns=feature_cols)
    
    # Map matching scalar columns safely
    # E.g. 'tempmax', 'humidity', 'precip', 'windspeed' from Visual Crossing natively matches our training config perfectly
    for col in feature_cols:
        if col in df_api.columns:
            # Transfer directly
            df_model_ready[col] = df_api[col]
            
    # Inject OHE location override based on user selection (since location doesn't come natively listed as name_X)
    target_state_col = f"name_{location}"
    if target_state_col in feature_cols:
        df_model_ready[target_state_col] = 1 # Active
    elif "name_Malaysia" in feature_cols:
        # Fallback to Malaysia baseline if specific state not selected or missing in training Set
        df_model_ready["name_Malaysia"] = 1
        
    # Scale entire matched dataframe using training boundaries
    scaled_data = scaler.transform(df_model_ready)
    
    # 3. Create the sequence overlaps
    # Predict day `T+1` relies on `[T-window_size+1 : T]`
    # We want to predict starting from TODAY onwards up to Day 15
    predictions = []
    forecast_dates = []
    
    # Range offsets to guarantee we predict Future forecast specifically
    for i in range(len(scaled_data) - window_size):
        seq = scaled_data[i : i + window_size]
        # shape into (1, window_size, features)
        seq_batch = np.expand_dims(seq, axis=0) 
        
        # Predict Probability of array `[Prob_0, Prob_1]` where Prob_1 is Heavy Rain
        probs = model.predict(seq_batch, verbose=0)[0]
        
        target_forecast_day = df_api.iloc[i + window_size]
        
        predictions.append({
            "datetime": target_forecast_day['datetime'],
            "temp": target_forecast_day.get('temp', 0),
            "humidity": target_forecast_day.get('humidity', 0),
            "precip": target_forecast_day.get('precip', 0),
            "alert": target_forecast_day.get('conditions', 'Unknown'),
            "flood_prob": float(probs[1]) * 100 # percentage scale
        })

    return jsonify({"forecast": predictions})

if __name__ == '__main__':
    # Run locally 
    app.run(debug=True, port=5000)
