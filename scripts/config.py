"""Universe and settings shared by the fetch and build scripts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
DOCS = ROOT / "docs"

START_DATE = "2023-01-01"  # ~3.8 years of daily history

# NIFTY 50 style large-cap universe: NSE symbol -> (company, sector)
STOCKS = {
    "RELIANCE": ("Reliance Industries", "Energy"),
    "TCS": ("Tata Consultancy Services", "IT"),
    "HDFCBANK": ("HDFC Bank", "Banking"),
    "ICICIBANK": ("ICICI Bank", "Banking"),
    "INFY": ("Infosys", "IT"),
    "BHARTIARTL": ("Bharti Airtel", "Telecom"),
    "ITC": ("ITC", "FMCG"),
    "SBIN": ("State Bank of India", "Banking"),
    "LT": ("Larsen & Toubro", "Infrastructure"),
    "HINDUNILVR": ("Hindustan Unilever", "FMCG"),
    "BAJFINANCE": ("Bajaj Finance", "Financial Services"),
    "KOTAKBANK": ("Kotak Mahindra Bank", "Banking"),
    "AXISBANK": ("Axis Bank", "Banking"),
    "HCLTECH": ("HCL Technologies", "IT"),
    "MARUTI": ("Maruti Suzuki", "Auto"),
    "SUNPHARMA": ("Sun Pharmaceutical", "Pharma"),
    "M&M": ("Mahindra & Mahindra", "Auto"),
    "ULTRACEMCO": ("UltraTech Cement", "Cement"),
    "TITAN": ("Titan Company", "Consumer"),
    "NTPC": ("NTPC", "Power"),
    "ASIANPAINT": ("Asian Paints", "Consumer"),
    "POWERGRID": ("Power Grid Corp", "Power"),
    "TATASTEEL": ("Tata Steel", "Metals"),
    "ONGC": ("ONGC", "Energy"),
    "ADANIENT": ("Adani Enterprises", "Infrastructure"),
    "ADANIPORTS": ("Adani Ports & SEZ", "Infrastructure"),
    "BAJAJFINSV": ("Bajaj Finserv", "Financial Services"),
    "NESTLEIND": ("Nestle India", "FMCG"),
    "WIPRO": ("Wipro", "IT"),
    "COALINDIA": ("Coal India", "Energy"),
    "JSWSTEEL": ("JSW Steel", "Metals"),
    "TECHM": ("Tech Mahindra", "IT"),
    "GRASIM": ("Grasim Industries", "Cement"),
    "HINDALCO": ("Hindalco Industries", "Metals"),
    "CIPLA": ("Cipla", "Pharma"),
    "DRREDDY": ("Dr. Reddy's Laboratories", "Pharma"),
    "SBILIFE": ("SBI Life Insurance", "Financial Services"),
    "HDFCLIFE": ("HDFC Life Insurance", "Financial Services"),
    "BAJAJ-AUTO": ("Bajaj Auto", "Auto"),
    "EICHERMOT": ("Eicher Motors", "Auto"),
    "BRITANNIA": ("Britannia Industries", "FMCG"),
    "APOLLOHOSP": ("Apollo Hospitals", "Healthcare"),
    "TATACONSUM": ("Tata Consumer Products", "FMCG"),
    "HEROMOTOCO": ("Hero MotoCorp", "Auto"),
    "SHRIRAMFIN": ("Shriram Finance", "Financial Services"),
    "BEL": ("Bharat Electronics", "Defence"),
    "TRENT": ("Trent", "Consumer"),
    "INDUSINDBK": ("IndusInd Bank", "Banking"),
    "TMPV": ("Tata Motors Passenger Vehicles", "Auto"),
    "JIOFIN": ("Jio Financial Services", "Financial Services"),
    "ETERNAL": ("Eternal (Zomato)", "Consumer"),
}

# Yahoo symbol -> display name
INDICES = {
    "^NSEI": "NIFTY 50",
    "^BSESN": "SENSEX",
    "^NSEBANK": "NIFTY BANK",
    "^CNXIT": "NIFTY IT",
    "^CNXPHARMA": "NIFTY PHARMA",
    "^CNXAUTO": "NIFTY AUTO",
    "^CNXFMCG": "NIFTY FMCG",
    "^CNXMETAL": "NIFTY METAL",
    "^CNXENERGY": "NIFTY ENERGY",
    "^NSEMDCP50": "NIFTY MIDCAP 50",
    "^INDIAVIX": "INDIA VIX",
}

# AMFI scheme code -> approximate AUM in Rs crore (used only to size the modelled holdings)
FUNDS = {
    122639: 120000,  # Parag Parikh Flexi Cap
    118989: 80000,   # HDFC Mid Cap
    118778: 65000,   # Nippon India Small Cap
    120586: 70000,   # ICICI Pru Large Cap
    118825: 40000,   # Mirae Asset Large Cap
    120828: 28000,   # Quant Small Cap
    125354: 25000,   # Axis Small Cap
    125497: 34000,   # SBI Small Cap
    118955: 80000,   # HDFC Flexi Cap
    120716: 24000,   # UTI Nifty 50 Index
    147622: 3000,    # Motilal Oswal Nifty Midcap 150 Index
    118632: 45000,   # Nippon India Large Cap
    120323: 55000,   # ICICI Pru Value
    118968: 100000,  # HDFC Balanced Advantage
    135781: 25000,   # Mirae Asset ELSS
    120847: 11000,   # Quant ELSS
    118285: 9000,    # Canara Robeco ELSS
    120594: 15000,   # ICICI Pru Technology
    119835: 47000,   # SBI Contra
    118759: 8500,    # Nippon India Pharma
    135800: 12000,   # Tata Digital India
    119071: 20000,   # DSP Midcap
    118535: 19000,   # Franklin India Flexi Cap
    119091: 60000,   # HDFC Liquid
    120692: 30000,   # ICICI Pru Corporate Bond
    # large cap
    119598: 50000, 120465: 33000, 120152: 10000, 119528: 29000, 118269: 16000, 119018: 38000, 118479: 2000,
    # large & mid, multi, focused
    118834: 40000, 120596: 20000, 120158: 27000, 118419: 10000, 118650: 45000, 118950: 20000,
    # mid cap
    118668: 38000, 120505: 31000, 119716: 23000, 140228: 10000, 120403: 7000,
    # small cap
    130503: 35000, 120164: 18000, 145206: 11000, 147946: 14000, 119212: 17000, 146130: 13000,
    # flexi cap
    120166: 54000, 120662: 26000, 119718: 22000, 120843: 7000,
    # ELSS, contra
    119723: 30000, 120503: 37000, 119242: 17000, 147481: 6000, 120348: 19000, 119769: 4800,
    # index
    143341: 6000, 119063: 21000, 147623: 1000,
    # sectoral / thematic
    120621: 8000, 133859: 9000, 118763: 8000, 119783: 4000, 151750: 7000, 149219: 2000,
    # hybrid, gold
    120377: 65000, 148457: 7000, 119771: 70000, 148958: 2700, 119839: 10000, 118663: 4000, 119788: 6000,
    # debt
    119800: 60000, 120197: 50000, 118987: 34000, 119533: 27000, 119016: 18000,
}

# F&O underlyings for the modelled option chain: name -> (spot source, strike step, lot size)
FNO = {
    "NIFTY": ("^NSEI", 50, 65),
    "BANKNIFTY": ("^NSEBANK", 100, 30),
    "RELIANCE": ("RELIANCE", 10, 500),
    "HDFCBANK": ("HDFCBANK", 10, 550),
    "ICICIBANK": ("ICICIBANK", 10, 700),
    "INFY": ("INFY", 20, 400),
    "TCS": ("TCS", 20, 175),
    "SBIN": ("SBIN", 10, 750),
}

RISK_FREE = 0.065  # annual, ~91-day T-bill
