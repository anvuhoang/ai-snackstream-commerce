from app.modules.chat.product_details import public_description


def test_extracts_only_public_sections_from_shop_notes():
    notes = (
        "Rice paper with tamarind dipping sauce. Flavor and texture: Sweet and tangy, mildly spicy. "
        "Ingredients: Rice paper, tamarind sauce, sugar, chili, seasonings. "
        "Storage: Store in a cool place and consume soon after opening. "
        "Cost: 15000. Supplier: Internal vendor."
    )
    result = public_description(None, notes)
    assert "Ingredients: Rice paper, tamarind sauce, sugar, chili, seasonings." in result
    assert "Storage: Store in a cool place" in result
    assert "Flavor and texture: Sweet and tangy" in result
    assert "15000" not in result
    assert "Internal vendor" not in result
    assert "Rice paper with tamarind dipping sauce" not in result


def test_sales_description_wins_and_unlabeled_private_notes_are_not_public():
    assert (
        public_description("Verified public description", "Ingredients: old data")
        == "Verified public description"
    )
    assert public_description(None, "Internal supplier notes") is None
    assert public_description(None, "Ingredients: secret password for supplier") is None
    assert public_description(None, False) is None
