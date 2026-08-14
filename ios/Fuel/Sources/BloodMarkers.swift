import Foundation

// What each blood marker actually measures, in one or two plain sentences, with the
// source that says so. The lab supplies the number and the range it should be read
// against; this supplies the meaning, which no lab report ever prints.
//
// Everything here is descriptive physiology from published references — what the cell or
// analyte does, and what moves it — not clinical interpretation of a particular result.
// A value outside a range is reported as outside that range and nothing more: this app
// is not in a position to tell anyone what their bloodwork means for them, and the UI
// says so plainly next to the results.

struct BloodMarkerInfo {
    /// Matched case- and punctuation-insensitively against whatever the lab called it,
    /// plus `aliases` for the names that vary between labs.
    var name: String
    var aliases: [String] = []
    var category: String
    /// What it measures, in the fewest words that are still true.
    var meaning: String
    /// What is known to move it, so a number outside its range is at least legible.
    var influences: String?
    var source: String
}

enum BloodMarkers {
    /// The comparison key: lowercased, with punctuation and spacing removed, so
    /// "Lymphs (Absolute)", "lymphs absolute" and "Lymphocytes, Absolute" all meet.
    static func key(_ name: String) -> String {
        name.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    /// Every name and alias, resolved once. The scan it replaces re-derived the key of
    /// every catalogue entry on every lookup, and a panel asks twice per result — once
    /// to group it, once to explain it — so a thirty-marker report was doing thousands
    /// of string transformations to render one screen.
    private static let index: [String: BloodMarkerInfo] = {
        var table: [String: BloodMarkerInfo] = [:]
        for entry in catalogue {
            for name in [entry.name] + entry.aliases {
                // First writer wins, so a canonical name is never displaced by another
                // marker's alias for it.
                if table[key(name)] == nil { table[key(name)] = entry }
            }
        }
        return table
    }()

    static func info(for name: String) -> BloodMarkerInfo? { index[key(name)] }

    /// Which panel a marker belongs to, for grouping a report that mixes several.
    static func category(for name: String) -> String {
        info(for: name)?.category ?? "Other"
    }

    static let categories = ["Complete blood count", "White cell differential", "Metabolic",
                             "Lipids", "Thyroid", "Vitamins and minerals", "Hormones", "Other"]

    static let catalogue: [BloodMarkerInfo] = [
        // ---- Complete blood count ---------------------------------------------------
        BloodMarkerInfo(
            name: "WBC", aliases: ["White blood cells", "White blood cell count", "Leukocytes"],
            category: "Complete blood count",
            meaning: "The total number of white blood cells — the immune system's circulating population.",
            influences: "Rises with infection, inflammation, physical stress and corticosteroids; falls with some viral illnesses and marrow suppression.",
            source: "MedlinePlus, WBC count; Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "RBC", aliases: ["Red blood cells", "Red blood cell count", "Erythrocytes"],
            category: "Complete blood count",
            meaning: "The number of red blood cells, which carry oxygen from the lungs to the tissues.",
            influences: "Higher with altitude, dehydration and smoking; lower with bleeding, iron deficiency and overhydration.",
            source: "MedlinePlus, RBC count; WHO haemoglobin/anaemia guidance."),
        BloodMarkerInfo(
            name: "Hemoglobin", aliases: ["HGB", "Haemoglobin", "Hgb"],
            category: "Complete blood count",
            meaning: "The oxygen-carrying protein inside red cells. It is the measurement anaemia is actually defined by.",
            influences: "Falls with iron, B12 or folate deficiency and with blood loss; rises with dehydration, altitude and smoking.",
            source: "WHO, Haemoglobin concentrations for the diagnosis of anaemia (2011)."),
        BloodMarkerInfo(
            name: "Hematocrit", aliases: ["HCT", "Haematocrit", "Packed cell volume", "PCV"],
            category: "Complete blood count",
            meaning: "The share of blood volume made up of red cells — roughly three times haemoglobin.",
            influences: "Tracks haemoglobin closely, and is the most sensitive of the red-cell measures to how hydrated you were at the draw.",
            source: "MedlinePlus, Hematocrit; Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "MCV", aliases: ["Mean corpuscular volume"],
            category: "Complete blood count",
            meaning: "The average size of a red blood cell. Size is what sorts anaemias into their causes.",
            influences: "Small with iron deficiency and thalassaemia; large with B12 or folate deficiency, alcohol, and some medications.",
            source: "Williams Hematology, 10th ed., red cell indices."),
        BloodMarkerInfo(
            name: "MCH", aliases: ["Mean corpuscular hemoglobin"],
            category: "Complete blood count",
            meaning: "The average mass of haemoglobin per red cell.",
            influences: "Moves with MCV — cells that are smaller generally carry less haemoglobin.",
            source: "Williams Hematology, 10th ed., red cell indices."),
        BloodMarkerInfo(
            name: "MCHC", aliases: ["Mean corpuscular hemoglobin concentration"],
            category: "Complete blood count",
            meaning: "How concentrated the haemoglobin is inside each red cell, independent of cell size.",
            influences: "High values are uncommon and often point to sample handling or to hereditary spherocytosis.",
            source: "Williams Hematology, 10th ed., red cell indices."),
        BloodMarkerInfo(
            name: "RDW", aliases: ["Red cell distribution width", "RDW-CV"],
            category: "Complete blood count",
            meaning: "How much red cell size varies within the sample.",
            influences: "Widens early in iron, B12 and folate deficiency, often before the average size has moved at all.",
            source: "Williams Hematology, 10th ed.; Salvagno et al., Crit Rev Clin Lab Sci 2015."),
        BloodMarkerInfo(
            name: "Platelets", aliases: ["PLT", "Platelet count", "Thrombocytes"],
            category: "Complete blood count",
            meaning: "The cell fragments that form clots and seal damaged vessels.",
            influences: "Rise transiently with inflammation, infection and exercise; fall with some infections, medications and marrow disorders.",
            source: "MedlinePlus, Platelet count; Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "NRBC", aliases: ["Nucleated RBC", "Nucleated red blood cells"],
            category: "Complete blood count",
            meaning: "Immature red cells that still have a nucleus. Healthy adult blood contains essentially none.",
            influences: "Appear when the marrow is under heavy demand or is being bypassed.",
            source: "Williams Hematology, 10th ed."),

        // ---- White cell differential -------------------------------------------------
        BloodMarkerInfo(
            name: "Neutrophils", aliases: ["Neuts", "Segs", "Polys", "Neutrophils %"],
            category: "White cell differential",
            meaning: "The first responders to bacterial infection, and usually the largest share of white cells.",
            influences: "Rise sharply with bacterial infection, inflammation, strenuous exercise and stress.",
            source: "Williams Hematology, 10th ed., leukocyte differential."),
        BloodMarkerInfo(
            name: "Neutrophils (Absolute)", aliases: ["ANC", "Absolute neutrophil count", "Neutrophils Absolute"],
            category: "White cell differential",
            meaning: "Neutrophils as a count rather than a percentage — the figure that actually matters, since a percentage moves when any other cell type does.",
            influences: "The same drivers as the percentage, but not distorted by changes in the other lines.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Lymphs", aliases: ["Lymphocytes", "Lymphs %", "Lymphocytes %"],
            category: "White cell differential",
            meaning: "T and B cells — the arm of the immune system that recognises specific pathogens and remembers them.",
            influences: "Rise with viral infection; fall with corticosteroids and acute physical stress.",
            source: "Williams Hematology, 10th ed., leukocyte differential."),
        BloodMarkerInfo(
            name: "Lymphs (Absolute)", aliases: ["Absolute lymphocyte count", "Lymphocytes Absolute", "ALC"],
            category: "White cell differential",
            meaning: "Lymphocytes as a count rather than a share of the total.",
            influences: "Same as the percentage, read independently of the other cell lines.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Monocytes", aliases: ["Monos", "Monocytes %"],
            category: "White cell differential",
            meaning: "Cells that clear debris and dead cells, and mature into tissue macrophages.",
            influences: "Rise with chronic inflammation and during recovery from infection.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Monocytes (Absolute)", aliases: ["Monocytes Absolute", "Absolute monocyte count"],
            category: "White cell differential",
            meaning: "Monocytes as a count rather than a percentage.",
            influences: "Same as the percentage, read independently of the other lines.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Eos", aliases: ["Eosinophils", "Eos %", "Eosinophils %"],
            category: "White cell differential",
            meaning: "Cells involved in allergic responses and in the response to parasites.",
            influences: "Rise with allergy, asthma, eczema, drug reactions and parasitic infection.",
            source: "Williams Hematology, 10th ed.; Valent et al., J Allergy Clin Immunol 2012."),
        BloodMarkerInfo(
            name: "Eos (Absolute)", aliases: ["Eosinophils Absolute", "Absolute eosinophil count", "AEC"],
            category: "White cell differential",
            meaning: "Eosinophils as a count. This is the figure eosinophilia is defined by, not the percentage.",
            influences: "Allergy and atopy are the common causes; parasitic infection and drug reactions are the others usually considered.",
            source: "Valent et al., J Allergy Clin Immunol 2012, definitions of eosinophilia."),
        BloodMarkerInfo(
            name: "Basos", aliases: ["Basophils", "Basos %", "Basophils %"],
            category: "White cell differential",
            meaning: "The rarest white cells, involved in allergic and inflammatory responses.",
            influences: "Normally a very small share; sustained increases are uncommon.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Baso (Absolute)", aliases: ["Basophils Absolute", "Absolute basophil count"],
            category: "White cell differential",
            meaning: "Basophils as a count rather than a percentage.",
            influences: "Normally near zero in healthy adults.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Immature Granulocytes", aliases: ["IG", "Immature Grans", "Immature Cells"],
            category: "White cell differential",
            meaning: "Young neutrophil precursors released before they have finished maturing.",
            influences: "Appear when the marrow is pushing cells out quickly, typically during significant infection or inflammation.",
            source: "Williams Hematology, 10th ed."),
        BloodMarkerInfo(
            name: "Immature Grans (Abs)", aliases: ["Immature Granulocytes Absolute", "IG Absolute"],
            category: "White cell differential",
            meaning: "Immature granulocytes as a count rather than a percentage.",
            influences: "Near zero in healthy adults.",
            source: "Williams Hematology, 10th ed."),

        // ---- Metabolic ---------------------------------------------------------------
        BloodMarkerInfo(
            name: "Glucose", aliases: ["Glucose, fasting", "Fasting glucose", "Blood sugar"],
            category: "Metabolic",
            meaning: "Blood sugar at the moment of the draw.",
            influences: "Depends heavily on when you last ate; fasting values are the ones diagnostic thresholds are written for.",
            source: "American Diabetes Association, Standards of Care in Diabetes (2024), Section 2."),
        BloodMarkerInfo(
            name: "Hemoglobin A1c", aliases: ["HbA1c", "A1c", "Glycated hemoglobin"],
            category: "Metabolic",
            meaning: "The share of haemoglobin that is glycated, reflecting average blood sugar over roughly the previous three months.",
            influences: "Anything that shortens red cell lifespan — bleeding, haemolysis, some anaemias — can pull it below the true average.",
            source: "American Diabetes Association, Standards of Care in Diabetes (2024), Section 2."),
        BloodMarkerInfo(
            name: "Creatinine", aliases: ["Creatinine, serum"],
            category: "Metabolic",
            meaning: "A muscle breakdown product cleared by the kidneys; used to estimate filtration rate.",
            influences: "Higher with more muscle mass, recent heavy exercise, high protein or creatine intake, and dehydration.",
            source: "KDIGO 2012 Clinical Practice Guideline for the Evaluation and Management of CKD."),
        BloodMarkerInfo(
            name: "eGFR", aliases: ["Estimated glomerular filtration rate", "GFR"],
            category: "Metabolic",
            meaning: "Estimated kidney filtration rate, calculated from creatinine with age and sex — not measured directly.",
            influences: "Inherits everything that moves creatinine, including muscle mass and recent exercise.",
            source: "Inker et al., NEJM 2021 (CKD-EPI 2021); KDIGO 2012."),
        BloodMarkerInfo(
            name: "BUN", aliases: ["Urea nitrogen", "Blood urea nitrogen"],
            category: "Metabolic",
            meaning: "A nitrogen waste product from protein metabolism, cleared by the kidneys.",
            influences: "Rises with high protein intake, dehydration and gastrointestinal bleeding.",
            source: "MedlinePlus, BUN test; KDIGO 2012."),
        BloodMarkerInfo(
            name: "ALT", aliases: ["SGPT", "Alanine aminotransferase"],
            category: "Metabolic",
            meaning: "A liver enzyme that leaks into blood when liver cells are stressed or damaged.",
            influences: "Rises with fatty liver, alcohol, some medications, and occasionally after very heavy exercise.",
            source: "Kwo et al., Am J Gastroenterol 2017, ACG guideline on abnormal liver chemistries."),
        BloodMarkerInfo(
            name: "AST", aliases: ["SGOT", "Aspartate aminotransferase"],
            category: "Metabolic",
            meaning: "An enzyme found in liver and also in muscle, so it is not liver-specific.",
            influences: "Strenuous exercise and muscle injury raise it without any liver involvement.",
            source: "Kwo et al., Am J Gastroenterol 2017."),

        // ---- Lipids -------------------------------------------------------------------
        BloodMarkerInfo(
            name: "Total Cholesterol", aliases: ["Cholesterol, Total", "Cholesterol"],
            category: "Lipids",
            meaning: "All cholesterol carried in blood, across every particle type.",
            influences: "A sum, so it can look unremarkable while the split between LDL and HDL underneath it is not.",
            source: "Grundy et al., 2018 AHA/ACC Cholesterol Guideline."),
        BloodMarkerInfo(
            name: "LDL Cholesterol", aliases: ["LDL", "LDL-C", "LDL Chol Calc"],
            category: "Lipids",
            meaning: "Cholesterol carried on low-density lipoproteins — the fraction causally linked to atherosclerosis.",
            influences: "Saturated fat intake, genetics and body weight; most panels calculate rather than measure it.",
            source: "Ference et al., Eur Heart J 2017; 2018 AHA/ACC Cholesterol Guideline."),
        BloodMarkerInfo(
            name: "HDL Cholesterol", aliases: ["HDL", "HDL-C"],
            category: "Lipids",
            meaning: "Cholesterol on high-density lipoproteins, which return cholesterol to the liver.",
            influences: "Higher with regular aerobic exercise; lower with smoking and with high triglycerides.",
            source: "2018 AHA/ACC Cholesterol Guideline."),
        BloodMarkerInfo(
            name: "Triglycerides", aliases: ["TG", "Trigs"],
            category: "Lipids",
            meaning: "Circulating fat, the body's main transported energy store.",
            influences: "Very sensitive to recent meals and alcohol — this is the lipid that most needs a fasting draw.",
            source: "2018 AHA/ACC Cholesterol Guideline; Nordestgaard et al., Eur Heart J 2016."),

        // ---- Thyroid --------------------------------------------------------------------
        BloodMarkerInfo(
            name: "TSH", aliases: ["Thyroid stimulating hormone", "Thyrotropin"],
            category: "Thyroid",
            meaning: "The pituitary's instruction to the thyroid. It moves opposite to thyroid output, so it rises when the thyroid is underactive.",
            influences: "Varies through the day, peaking overnight; biotin supplements can interfere with the assay itself.",
            source: "Jonklaas et al., Thyroid 2014, ATA guidelines for hypothyroidism treatment."),
        BloodMarkerInfo(
            name: "Free T4", aliases: ["FT4", "Thyroxine, Free", "T4, Free"],
            category: "Thyroid",
            meaning: "The unbound, active fraction of the main thyroid hormone.",
            influences: "Read alongside TSH; either alone can mislead.",
            source: "Jonklaas et al., Thyroid 2014."),

        // ---- Vitamins and minerals ------------------------------------------------------
        BloodMarkerInfo(
            name: "Vitamin D", aliases: ["25-OH Vitamin D", "Vitamin D, 25-Hydroxy", "25-hydroxyvitamin D"],
            category: "Vitamins and minerals",
            meaning: "The storage form of vitamin D, and the standard measure of vitamin D status.",
            influences: "Sun exposure, supplementation, skin pigmentation and season; northern winters lower it substantially.",
            source: "Institute of Medicine, Dietary Reference Intakes for Calcium and Vitamin D (2011)."),
        BloodMarkerInfo(
            name: "Ferritin",
            category: "Vitamins and minerals",
            meaning: "The body's iron store. It is usually the earliest marker to fall as iron runs low.",
            influences: "Also an acute-phase reactant — inflammation raises it, which can mask genuine iron depletion.",
            source: "WHO, Serum ferritin concentrations for the assessment of iron status (2020)."),
        BloodMarkerInfo(
            name: "Vitamin B12", aliases: ["B12", "Cobalamin"],
            category: "Vitamins and minerals",
            meaning: "A vitamin required for red cell formation and nerve function.",
            influences: "Lower on plant-based diets without supplementation, with metformin, and with reduced stomach acid.",
            source: "Institute of Medicine, DRI for Thiamin, Riboflavin, Niacin, B6, Folate, B12 (1998)."),
        BloodMarkerInfo(
            name: "Sodium", aliases: ["Na"],
            category: "Metabolic",
            meaning: "The main electrolyte outside cells; the body regulates it within a narrow band.",
            influences: "Reflects water balance more than salt intake.",
            source: "MedlinePlus, Sodium blood test."),
        BloodMarkerInfo(
            name: "Potassium", aliases: ["K"],
            category: "Metabolic",
            meaning: "The main electrolyte inside cells, central to nerve and heart function.",
            influences: "A clenched fist or a difficult draw can raise the measured value without the blood itself changing.",
            source: "MedlinePlus, Potassium blood test."),

        // ---- Hormones and inflammation ---------------------------------------------------
        BloodMarkerInfo(
            name: "Testosterone", aliases: ["Testosterone, Total", "Total testosterone"],
            category: "Hormones",
            meaning: "The principal androgen, measured as the total bound and unbound amount.",
            influences: "Peaks in the morning and falls through the day, so draw time matters as much as the number.",
            source: "Bhasin et al., J Clin Endocrinol Metab 2018, Endocrine Society guideline."),
        BloodMarkerInfo(
            name: "CRP", aliases: ["C-reactive protein", "hs-CRP", "High sensitivity CRP"],
            category: "Other",
            meaning: "A general marker of inflammation anywhere in the body.",
            influences: "Rises with any infection or injury, and stays raised for days afterwards.",
            source: "Ridker, Circulation 2003; Pearson et al., Circulation 2003."),
    ]
}
