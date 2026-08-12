import Foundation

// A small offline table of foods people log constantly, with published per-serving
// values so a manual entry needs no model call and no network round-trip. Values are
// USDA FoodData Central (SR Legacy / Foundation / Survey-FNDDS) rounded to whole
// grams — close enough for a food log, and honest about being reference values for a
// standard serving rather than a measurement of the thing on your plate.
//
// This exists so the manual path is genuinely manual: type nothing, tap the food,
// adjust if you want, log. It also backs the autocomplete on the description field.

struct CommonFood: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var portion: String
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var group: String

    var nutrition: EstimatedNutrition {
        EstimatedNutrition(calories: calories, protein: protein, carbs: carbs, fat: fat, fiber: fiber)
    }
}

enum CommonFoods {
    static let groups = ["Fruit", "Vegetables", "Grains", "Protein", "Dairy", "Snacks & sweets", "Meals", "Drinks"]

    static let all: [CommonFood] = [
        // ---- Fruit -------------------------------------------------------------
        CommonFood(name: "Banana", portion: "1 medium (118 g)", calories: 105, protein: 1, carbs: 27, fat: 0, fiber: 3, group: "Fruit"),
        CommonFood(name: "Apple", portion: "1 medium (182 g)", calories: 95, protein: 0, carbs: 25, fat: 0, fiber: 4, group: "Fruit"),
        CommonFood(name: "Orange", portion: "1 medium (131 g)", calories: 62, protein: 1, carbs: 15, fat: 0, fiber: 3, group: "Fruit"),
        CommonFood(name: "Strawberries", portion: "1 cup (144 g)", calories: 46, protein: 1, carbs: 11, fat: 0, fiber: 3, group: "Fruit"),
        CommonFood(name: "Blueberries", portion: "1 cup (148 g)", calories: 84, protein: 1, carbs: 21, fat: 0, fiber: 4, group: "Fruit"),
        CommonFood(name: "Grapes", portion: "1 cup (151 g)", calories: 104, protein: 1, carbs: 27, fat: 0, fiber: 1, group: "Fruit"),
        CommonFood(name: "Avocado", portion: "1/2 medium (68 g)", calories: 114, protein: 1, carbs: 6, fat: 10, fiber: 5, group: "Fruit"),
        CommonFood(name: "Mango", portion: "1 cup sliced (165 g)", calories: 99, protein: 1, carbs: 25, fat: 1, fiber: 3, group: "Fruit"),
        // ---- Vegetables ---------------------------------------------------------
        CommonFood(name: "Broccoli", portion: "1 cup chopped (91 g)", calories: 31, protein: 3, carbs: 6, fat: 0, fiber: 2, group: "Vegetables"),
        CommonFood(name: "Spinach", portion: "1 cup raw (30 g)", calories: 7, protein: 1, carbs: 1, fat: 0, fiber: 1, group: "Vegetables"),
        CommonFood(name: "Carrots", portion: "1 cup chopped (128 g)", calories: 52, protein: 1, carbs: 12, fat: 0, fiber: 4, group: "Vegetables"),
        CommonFood(name: "Sweet potato", portion: "1 medium baked (114 g)", calories: 103, protein: 2, carbs: 24, fat: 0, fiber: 4, group: "Vegetables"),
        CommonFood(name: "Salad, mixed greens", portion: "2 cups (85 g)", calories: 15, protein: 1, carbs: 3, fat: 0, fiber: 2, group: "Vegetables"),
        // ---- Grains -------------------------------------------------------------
        CommonFood(name: "White rice, cooked", portion: "1 cup (158 g)", calories: 205, protein: 4, carbs: 45, fat: 0, fiber: 1, group: "Grains"),
        CommonFood(name: "Brown rice, cooked", portion: "1 cup (195 g)", calories: 218, protein: 5, carbs: 46, fat: 2, fiber: 4, group: "Grains"),
        CommonFood(name: "Pasta, cooked", portion: "1 cup (140 g)", calories: 221, protein: 8, carbs: 43, fat: 1, fiber: 3, group: "Grains"),
        CommonFood(name: "Bread, whole wheat", portion: "1 slice (43 g)", calories: 110, protein: 5, carbs: 19, fat: 2, fiber: 3, group: "Grains"),
        CommonFood(name: "Oatmeal, cooked", portion: "1 cup (234 g)", calories: 166, protein: 6, carbs: 28, fat: 4, fiber: 4, group: "Grains"),
        CommonFood(name: "Bagel, plain", portion: "1 medium (105 g)", calories: 289, protein: 11, carbs: 56, fat: 2, fiber: 2, group: "Grains"),
        CommonFood(name: "Quinoa, cooked", portion: "1 cup (185 g)", calories: 222, protein: 8, carbs: 39, fat: 4, fiber: 5, group: "Grains"),
        // ---- Protein ------------------------------------------------------------
        CommonFood(name: "Chicken breast, cooked", portion: "3 oz (85 g)", calories: 128, protein: 26, carbs: 0, fat: 3, fiber: 0, group: "Protein"),
        CommonFood(name: "Egg", portion: "1 large (50 g)", calories: 72, protein: 6, carbs: 0, fat: 5, fiber: 0, group: "Protein"),
        CommonFood(name: "Salmon, cooked", portion: "3 oz (85 g)", calories: 175, protein: 19, carbs: 0, fat: 11, fiber: 0, group: "Protein"),
        CommonFood(name: "Ground beef, 85% lean", portion: "3 oz cooked (85 g)", calories: 218, protein: 22, carbs: 0, fat: 13, fiber: 0, group: "Protein"),
        CommonFood(name: "Tofu, firm", portion: "1/2 cup (126 g)", calories: 181, protein: 22, carbs: 5, fat: 11, fiber: 3, group: "Protein"),
        CommonFood(name: "Black beans, cooked", portion: "1 cup (172 g)", calories: 227, protein: 15, carbs: 41, fat: 1, fiber: 15, group: "Protein"),
        CommonFood(name: "Peanut butter", portion: "2 tbsp (32 g)", calories: 188, protein: 8, carbs: 6, fat: 16, fiber: 2, group: "Protein"),
        CommonFood(name: "Almonds", portion: "1 oz (28 g)", calories: 164, protein: 6, carbs: 6, fat: 14, fiber: 4, group: "Protein"),
        // ---- Dairy --------------------------------------------------------------
        CommonFood(name: "Milk, 2%", portion: "1 cup (244 g)", calories: 122, protein: 8, carbs: 12, fat: 5, fiber: 0, group: "Dairy"),
        CommonFood(name: "Greek yogurt, plain nonfat", portion: "1 cup (227 g)", calories: 133, protein: 23, carbs: 9, fat: 0, fiber: 0, group: "Dairy"),
        CommonFood(name: "Cheddar cheese", portion: "1 oz (28 g)", calories: 115, protein: 7, carbs: 1, fat: 9, fiber: 0, group: "Dairy"),
        CommonFood(name: "Ice cream, vanilla", portion: "1/2 cup (66 g)", calories: 137, protein: 2, carbs: 16, fat: 7, fiber: 0, group: "Dairy"),
        // ---- Snacks & sweets ----------------------------------------------------
        CommonFood(name: "Potato chips", portion: "1 oz (28 g)", calories: 152, protein: 2, carbs: 15, fat: 10, fiber: 1, group: "Snacks & sweets"),
        CommonFood(name: "Chocolate chip cookie", portion: "1 medium (16 g)", calories: 78, protein: 1, carbs: 10, fat: 4, fiber: 0, group: "Snacks & sweets"),
        CommonFood(name: "Dark chocolate", portion: "1 oz (28 g)", calories: 155, protein: 2, carbs: 17, fat: 9, fiber: 2, group: "Snacks & sweets"),
        CommonFood(name: "Granola bar", portion: "1 bar (40 g)", calories: 168, protein: 4, carbs: 26, fat: 6, fiber: 2, group: "Snacks & sweets"),
        CommonFood(name: "Popcorn, air-popped", portion: "3 cups (24 g)", calories: 93, protein: 3, carbs: 19, fat: 1, fiber: 4, group: "Snacks & sweets"),
        // ---- Meals --------------------------------------------------------------
        CommonFood(name: "Pizza, cheese", portion: "1 slice (107 g)", calories: 285, protein: 12, carbs: 36, fat: 10, fiber: 2, group: "Meals"),
        CommonFood(name: "Cheeseburger", portion: "1 sandwich (154 g)", calories: 396, protein: 20, carbs: 34, fat: 20, fiber: 2, group: "Meals"),
        CommonFood(name: "Burrito, chicken", portion: "1 burrito (280 g)", calories: 540, protein: 30, carbs: 62, fat: 18, fiber: 6, group: "Meals"),
        CommonFood(name: "Turkey sandwich", portion: "1 sandwich (200 g)", calories: 380, protein: 25, carbs: 45, fat: 11, fiber: 4, group: "Meals"),
        CommonFood(name: "Caesar salad with chicken", portion: "1 bowl (300 g)", calories: 470, protein: 33, carbs: 14, fat: 32, fiber: 3, group: "Meals"),
        CommonFood(name: "French fries", portion: "medium (117 g)", calories: 365, protein: 4, carbs: 48, fat: 17, fiber: 4, group: "Meals"),
        CommonFood(name: "Sushi roll, salmon avocado", portion: "6 pieces (170 g)", calories: 304, protein: 12, carbs: 42, fat: 9, fiber: 3, group: "Meals"),
        // ---- Drinks -------------------------------------------------------------
        CommonFood(name: "Coffee, black", portion: "1 cup (237 g)", calories: 2, protein: 0, carbs: 0, fat: 0, fiber: 0, group: "Drinks"),
        CommonFood(name: "Latte, whole milk", portion: "16 oz (473 g)", calories: 220, protein: 12, carbs: 18, fat: 11, fiber: 0, group: "Drinks"),
        CommonFood(name: "Orange juice", portion: "1 cup (248 g)", calories: 112, protein: 2, carbs: 26, fat: 0, fiber: 0, group: "Drinks"),
        CommonFood(name: "Soda, cola", portion: "12 oz can (368 g)", calories: 136, protein: 0, carbs: 35, fat: 0, fiber: 0, group: "Drinks"),
        CommonFood(name: "Beer, regular", portion: "12 oz (356 g)", calories: 153, protein: 2, carbs: 13, fat: 0, fiber: 0, group: "Drinks"),
        CommonFood(name: "Protein shake, whey", portion: "1 scoop in water (30 g)", calories: 120, protein: 24, carbs: 3, fat: 2, fiber: 1, group: "Drinks"),
    ]

    /// Prefix matches first, then anything containing the query — so typing "ric"
    /// surfaces "Rice" ahead of "Brown rice", which is the order a person expects.
    static func matches(_ query: String, limit: Int = 6) -> [CommonFood] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard q.count >= 2 else { return [] }
        let prefix = all.filter { $0.name.lowercased().hasPrefix(q) }
        let rest = all.filter { !$0.name.lowercased().hasPrefix(q) && $0.name.lowercased().contains(q) }
        return Array((prefix + rest).prefix(limit))
    }
}
