# --- INSTALL DEPENDENCIES ---
import pandas as pd
import geopandas as gpd
import folium
from zipfile import ZipFile
import requests
import io

# --- HELPER FUNCTION: download & read stops.txt ---
def load_gtfs_stops(gtfs_url, agency_name):
    print(f"Downloading {agency_name} GTFS…")
    r = requests.get(gtfs_url)
    z = ZipFile(io.BytesIO(r.content))
    stops = pd.read_csv(z.open("stops.txt"))
    stops["agency"] = agency_name
    return stops

# --- GTFS feeds for Barcelona metro & suburban ---
tmb_gtfs = "https://opendata.tmb.cat/dataset/2ad53d5a-3c7a-4cfa-86b3-b77f97a6e8d0/resource/af3f18cc-f2c5-44b4-92ef-08fa9e8a57b1/download/google_transit.zip"  # TMB Metro
fgc_gtfs = "https://opendata.fgc.cat/dataset/e8ce3b04-0d90-4a46-b733-77f9dd12b561/resource/61a02b76-9e2e-4a58-a7b8-3625166b1db3/download/google_transit.zip"  # FGC Suburban

# --- LOAD BOTH ---
stops_tmb = load_gtfs_stops(tmb_gtfs, "TMB Metro")
stops_fgc = load_gtfs_stops(fgc_gtfs, "FGC Suburban")

# --- COMBINE + CLEAN ---
stops_all = pd.concat([stops_tmb, stops_fgc], ignore_index=True)
stops_all = stops_all.drop_duplicates(subset=["stop_id"])
stops_all = stops_all.dropna(subset=["stop_lat", "stop_lon"])

# --- CONVERT TO GEODATAFRAME ---
gdf = gpd.GeoDataFrame(
    stops_all,
    geometry=gpd.points_from_xy(stops_all.stop_lon, stops_all.stop_lat),
    crs="EPSG:4326"
)

# --- SAVE TO SHAPEFILE ---
output_file = "barcelona_metro_suburban_stops.shp"
gdf.to_file(output_file)
print(f"✅ Shapefile saved as {output_file}")

# --- INTERACTIVE MAP PREVIEW ---
barcelona_center = [41.3851, 2.1734]  # Plaça Catalunya
m = folium.Map(location=barcelona_center, zoom_start=11, tiles="CartoDB positron")

for _, row in gdf.iterrows():
    folium.CircleMarker(
        location=[row.stop_lat, row.stop_lon],
        radius=3,
        color="blue" if row.agency == "TMB Metro" else "green",
        fill=True,
        fill_opacity=0.7,
        popup=f"{row['stop_name']} ({row['agency']})"
    ).add_to(m)

m.save("barcelona_transit_stops.html")
m
