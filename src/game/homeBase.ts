/**
 * Lazy Home Yard chunk: the yard generator and its controller (zone triggers and the Heavy Shop
 * overlay). Loaded the first time the player rolls into the yard, so none of it counts toward the
 * initial game JS budget.
 */
export { populateHomeYard } from '../world/homeYard';
export { HomeYardController } from './homeController';
