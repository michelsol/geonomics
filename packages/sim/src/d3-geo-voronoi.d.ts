// The part of d3-geo-voronoi the map uses; the package ships no types.
declare module "d3-geo-voronoi" {
  export interface GeoDelaunay {
    neighbors: number[][]; // per point, its Delaunay neighbors
    polygons: number[][]; // per point, its Voronoi cell as indices into `centers`, in order around the cell
    centers: [number, number][]; // Voronoi vertices as [longitude, latitude] in degrees
    find(longitude: number, latitude: number, next?: number): number; // the point nearest to a position
  }
  export function geoDelaunay(points: readonly (readonly [number, number])[]): GeoDelaunay;
}
