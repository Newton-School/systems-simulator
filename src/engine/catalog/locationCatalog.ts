import type { LocationProvider } from '../core/types'

export const LOCATION_CATALOGUE_VERSION = '2026-09'

export interface CloudRegionCatalogEntry {
  provider: Exclude<LocationProvider, 'custom'>
  code: string
  label: string
  latitude: number
  longitude: number
}

const region = (
  provider: CloudRegionCatalogEntry['provider'],
  code: string,
  label: string,
  latitude: number,
  longitude: number
): CloudRegionCatalogEntry => ({ provider, code, label, latitude, longitude })

/**
 * Versioned, offline location catalogue. Coordinates are metro-level modelling
 * anchors, not data-centre addresses. Simulation never calls a provider API, so
 * a topology stays reproducible after a provider adds or renames a region.
 */
export const CLOUD_REGION_CATALOGUE: readonly CloudRegionCatalogEntry[] = [
  // AWS commercial regions (AWS Global Infrastructure snapshot, 2026-09).
  region('aws', 'us-east-1', 'US East (N. Virginia)', 38.95, -77.45),
  region('aws', 'us-east-2', 'US East (Ohio)', 40.42, -82.91),
  region('aws', 'us-west-1', 'US West (N. California)', 37.35, -121.96),
  region('aws', 'us-west-2', 'US West (Oregon)', 45.84, -119.7),
  region('aws', 'ca-central-1', 'Canada (Central)', 45.5, -73.57),
  region('aws', 'ca-west-1', 'Canada West (Calgary)', 51.05, -114.07),
  region('aws', 'mx-central-1', 'Mexico (Central)', 20.59, -100.39),
  region('aws', 'sa-east-1', 'South America (São Paulo)', -23.55, -46.63),
  region('aws', 'af-south-1', 'Africa (Cape Town)', -33.92, 18.42),
  region('aws', 'eu-central-1', 'Europe (Frankfurt)', 50.11, 8.68),
  region('aws', 'eu-central-2', 'Europe (Zurich)', 47.38, 8.54),
  region('aws', 'eu-west-1', 'Europe (Ireland)', 53.35, -6.26),
  region('aws', 'eu-west-2', 'Europe (London)', 51.51, -0.13),
  region('aws', 'eu-west-3', 'Europe (Paris)', 48.86, 2.35),
  region('aws', 'eu-north-1', 'Europe (Stockholm)', 59.33, 18.07),
  region('aws', 'eu-south-1', 'Europe (Milan)', 45.46, 9.19),
  region('aws', 'eu-south-2', 'Europe (Spain)', 40.42, -3.7),
  region('aws', 'ap-east-1', 'Asia Pacific (Hong Kong)', 22.32, 114.17),
  region('aws', 'ap-east-2', 'Asia Pacific (Taipei)', 25.03, 121.57),
  region('aws', 'ap-south-1', 'Asia Pacific (Mumbai)', 19.08, 72.88),
  region('aws', 'ap-south-2', 'Asia Pacific (Hyderabad)', 17.39, 78.49),
  region('aws', 'ap-northeast-1', 'Asia Pacific (Tokyo)', 35.68, 139.69),
  region('aws', 'ap-northeast-2', 'Asia Pacific (Seoul)', 37.57, 126.98),
  region('aws', 'ap-northeast-3', 'Asia Pacific (Osaka)', 34.69, 135.5),
  region('aws', 'ap-southeast-1', 'Asia Pacific (Singapore)', 1.35, 103.82),
  region('aws', 'ap-southeast-2', 'Asia Pacific (Sydney)', -33.87, 151.21),
  region('aws', 'ap-southeast-3', 'Asia Pacific (Jakarta)', -6.21, 106.85),
  region('aws', 'ap-southeast-4', 'Asia Pacific (Melbourne)', -37.81, 144.96),
  region('aws', 'ap-southeast-5', 'Asia Pacific (Malaysia)', 3.14, 101.69),
  region('aws', 'ap-southeast-6', 'Asia Pacific (New Zealand)', -36.85, 174.76),
  region('aws', 'ap-southeast-7', 'Asia Pacific (Thailand)', 13.76, 100.5),
  region('aws', 'il-central-1', 'Israel (Tel Aviv)', 32.09, 34.78),
  region('aws', 'me-central-1', 'Middle East (UAE)', 25.2, 55.27),
  region('aws', 'me-south-1', 'Middle East (Bahrain)', 26.22, 50.59),

  // Google Cloud regional anchors.
  region('gcp', 'us-central1', 'Iowa', 41.26, -95.86),
  region('gcp', 'us-east1', 'South Carolina', 33.84, -80.9),
  region('gcp', 'us-east4', 'Northern Virginia', 38.95, -77.45),
  region('gcp', 'us-east5', 'Columbus', 39.96, -83.0),
  region('gcp', 'us-south1', 'Dallas', 32.78, -96.8),
  region('gcp', 'us-west1', 'Oregon', 45.52, -122.68),
  region('gcp', 'us-west2', 'Los Angeles', 34.05, -118.24),
  region('gcp', 'us-west3', 'Salt Lake City', 40.76, -111.89),
  region('gcp', 'us-west4', 'Las Vegas', 36.17, -115.14),
  region('gcp', 'us-west8', 'Phoenix', 33.45, -112.07),
  region('gcp', 'northamerica-northeast1', 'Montréal', 45.5, -73.57),
  region('gcp', 'northamerica-northeast2', 'Toronto', 43.65, -79.38),
  region('gcp', 'northamerica-south1', 'Querétaro', 20.59, -100.39),
  region('gcp', 'southamerica-east1', 'São Paulo', -23.55, -46.63),
  region('gcp', 'southamerica-west1', 'Santiago', -33.45, -70.67),
  region('gcp', 'europe-west1', 'Belgium', 50.85, 4.35),
  region('gcp', 'europe-west2', 'London', 51.51, -0.13),
  region('gcp', 'europe-west3', 'Frankfurt', 50.11, 8.68),
  region('gcp', 'europe-west4', 'Netherlands', 53.44, 6.84),
  region('gcp', 'europe-west6', 'Zurich', 47.38, 8.54),
  region('gcp', 'europe-west8', 'Milan', 45.46, 9.19),
  region('gcp', 'europe-west9', 'Paris', 48.86, 2.35),
  region('gcp', 'europe-north1', 'Finland', 60.57, 27.19),
  region('gcp', 'europe-north2', 'Stockholm', 59.33, 18.07),
  region('gcp', 'europe-central2', 'Warsaw', 52.23, 21.01),
  region('gcp', 'europe-southwest1', 'Madrid', 40.42, -3.7),
  region('gcp', 'europe-west10', 'Berlin', 52.52, 13.41),
  region('gcp', 'europe-west12', 'Turin', 45.07, 7.69),
  region('gcp', 'asia-east1', 'Taiwan', 25.03, 121.57),
  region('gcp', 'asia-east2', 'Hong Kong', 22.32, 114.17),
  region('gcp', 'asia-northeast1', 'Tokyo', 35.68, 139.69),
  region('gcp', 'asia-northeast2', 'Osaka', 34.69, 135.5),
  region('gcp', 'asia-northeast3', 'Seoul', 37.57, 126.98),
  region('gcp', 'asia-south1', 'Mumbai', 19.08, 72.88),
  region('gcp', 'asia-south2', 'Delhi', 28.61, 77.21),
  region('gcp', 'asia-southeast1', 'Singapore', 1.35, 103.82),
  region('gcp', 'asia-southeast2', 'Jakarta', -6.21, 106.85),
  region('gcp', 'asia-southeast3', 'Bangkok', 13.76, 100.5),
  region('gcp', 'australia-southeast1', 'Sydney', -33.87, 151.21),
  region('gcp', 'australia-southeast2', 'Melbourne', -37.81, 144.96),
  region('gcp', 'me-west1', 'Tel Aviv', 32.09, 34.78),
  region('gcp', 'me-central1', 'Doha', 25.29, 51.53),
  region('gcp', 'me-central2', 'Dammam', 26.42, 50.09),
  region('gcp', 'africa-south1', 'Johannesburg', -26.2, 28.05),

  // Azure public-cloud regions (including restricted-access regions).
  region('azure', 'australiacentral', 'Australia Central', -35.28, 149.13),
  region('azure', 'australiacentral2', 'Australia Central 2', -35.28, 149.13),
  region('azure', 'australiaeast', 'Australia East', -33.87, 151.21),
  region('azure', 'australiasoutheast', 'Australia Southeast', -37.81, 144.96),
  region('azure', 'austriaeast', 'Austria East', 48.21, 16.37),
  region('azure', 'belgiumcentral', 'Belgium Central', 50.85, 4.35),
  region('azure', 'brazilsouth', 'Brazil South', -23.55, -46.63),
  region('azure', 'brazilsoutheast', 'Brazil Southeast', -22.91, -43.17),
  region('azure', 'canadacentral', 'Canada Central', 43.65, -79.38),
  region('azure', 'canadaeast', 'Canada East', 46.81, -71.21),
  region('azure', 'centralindia', 'Central India', 18.52, 73.86),
  region('azure', 'eastus', 'East US', 37.43, -78.66),
  region('azure', 'eastus2', 'East US 2', 36.67, -78.39),
  region('azure', 'centralus', 'Central US', 41.59, -93.62),
  region('azure', 'chilecentral', 'Chile Central', -33.45, -70.67),
  region('azure', 'denmarkeast', 'Denmark East', 55.68, 12.57),
  region('azure', 'southcentralus', 'South Central US', 29.42, -98.49),
  region('azure', 'westus', 'West US', 37.78, -122.42),
  region('azure', 'westus2', 'West US 2', 47.61, -122.33),
  region('azure', 'westus3', 'West US 3', 33.45, -112.07),
  region('azure', 'northcentralus', 'North Central US', 41.88, -87.63),
  region('azure', 'westcentralus', 'West Central US', 41.14, -104.82),
  region('azure', 'northeurope', 'North Europe', 53.35, -6.26),
  region('azure', 'westeurope', 'West Europe', 52.37, 4.9),
  region('azure', 'uksouth', 'UK South', 51.51, -0.13),
  region('azure', 'ukwest', 'UK West', 51.48, -3.18),
  region('azure', 'francecentral', 'France Central', 48.86, 2.35),
  region('azure', 'francesouth', 'France South', 43.3, 5.37),
  region('azure', 'germanynorth', 'Germany North', 52.52, 13.41),
  region('azure', 'germanywestcentral', 'Germany West Central', 50.11, 8.68),
  region('azure', 'switzerlandnorth', 'Switzerland North', 47.38, 8.54),
  region('azure', 'switzerlandwest', 'Switzerland West', 46.2, 6.14),
  region('azure', 'swedencentral', 'Sweden Central', 60.67, 17.14),
  region('azure', 'swedensouth', 'Sweden South', 55.6, 13.0),
  region('azure', 'norwayeast', 'Norway East', 59.91, 10.75),
  region('azure', 'norwaywest', 'Norway West', 58.97, 5.73),
  region('azure', 'polandcentral', 'Poland Central', 52.23, 21.01),
  region('azure', 'spaincentral', 'Spain Central', 40.42, -3.7),
  region('azure', 'eastasia', 'East Asia', 22.32, 114.17),
  region('azure', 'southeastasia', 'Southeast Asia', 1.35, 103.82),
  region('azure', 'southindia', 'South India', 13.08, 80.27),
  region('azure', 'indiasouthcentral', 'India South Central', 17.39, 78.49),
  region('azure', 'westindia', 'West India', 19.08, 72.88),
  region('azure', 'indonesiacentral', 'Indonesia Central', -6.21, 106.85),
  region('azure', 'italynorth', 'Italy North', 45.46, 9.19),
  region('azure', 'japaneast', 'Japan East', 35.68, 139.69),
  region('azure', 'japanwest', 'Japan West', 34.69, 135.5),
  region('azure', 'koreacentral', 'Korea Central', 37.57, 126.98),
  region('azure', 'koreasouth', 'Korea South', 35.18, 129.08),
  region('azure', 'malaysiawest', 'Malaysia West', 3.14, 101.69),
  region('azure', 'mexicocentral', 'Mexico Central', 20.59, -100.39),
  region('azure', 'newzealandnorth', 'New Zealand North', -36.85, 174.76),
  region('azure', 'israelcentral', 'Israel Central', 32.09, 34.78),
  region('azure', 'uaecentral', 'UAE Central', 24.45, 54.38),
  region('azure', 'uaenorth', 'UAE North', 25.2, 55.27),
  region('azure', 'qatarcentral', 'Qatar Central', 25.29, 51.53),
  region('azure', 'southafricanorth', 'South Africa North', -26.2, 28.05),
  region('azure', 'southafricawest', 'South Africa West', -33.92, 18.42),

  // IBM Cloud MZR/SC-MZR region codes. Zones append -1/-2/-3.
  region('ibm', 'us-south', 'Dallas', 32.78, -96.8),
  region('ibm', 'us-east', 'Washington DC', 38.91, -77.04),
  region('ibm', 'br-sao', 'São Paulo', -23.55, -46.63),
  region('ibm', 'ca-tor', 'Toronto', 43.65, -79.38),
  region('ibm', 'ca-mon', 'Montréal', 45.5, -73.57),
  region('ibm', 'eu-de', 'Frankfurt', 50.11, 8.68),
  region('ibm', 'eu-gb', 'London', 51.51, -0.13),
  region('ibm', 'eu-es', 'Madrid', 40.42, -3.7),
  region('ibm', 'in-che', 'Chennai', 13.08, 80.27),
  region('ibm', 'in-mum', 'Mumbai', 19.08, 72.88),
  region('ibm', 'jp-tok', 'Tokyo', 35.68, 139.69),
  region('ibm', 'jp-osa', 'Osaka', 34.69, 135.5),
  region('ibm', 'au-syd', 'Sydney', -33.87, 151.21)
]

const BY_PROVIDER_AND_CODE = new Map(
  CLOUD_REGION_CATALOGUE.map((entry) => [`${entry.provider}:${entry.code}`, entry] as const)
)

export function findCloudRegion(
  provider: LocationProvider | undefined,
  code: string | undefined
): CloudRegionCatalogEntry | undefined {
  if (!provider || !code || provider === 'custom') return undefined
  return BY_PROVIDER_AND_CODE.get(`${provider}:${code}`)
}

export function cloudRegionsForProvider(
  provider: LocationProvider | undefined
): readonly CloudRegionCatalogEntry[] {
  if (!provider || provider === 'custom') return []
  return CLOUD_REGION_CATALOGUE.filter((entry) => entry.provider === provider)
}
