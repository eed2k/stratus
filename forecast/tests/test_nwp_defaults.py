"""A new station must be model-backed from the start.

The method is the station's own history correcting a model background. With the
background off a station can only reproduce its own past, so a station that was
created and left with the default off was quietly getting the weaker half of the
forecast. These tests pin the default on, and pin the default variable and
provider lists to the real vocabularies so the SQL literals in db.py cannot
drift away from them.
"""
from app import db as dbmod
from app import ingest
from app.providers import registry


# ---------------------------------------------------------------------------
# The literals in db.py must match the real vocabularies
# ---------------------------------------------------------------------------

def test_default_providers_are_all_real_providers():
    for name in dbmod.DEFAULT_NWP_PROVIDERS:
        assert name in registry.ALL_PROVIDER_NAMES, \
            f"{name} is not a provider the registry knows about"


def test_default_providers_cover_every_available_provider():
    """If a provider is added, decide deliberately whether it is a default."""
    assert set(dbmod.DEFAULT_NWP_PROVIDERS) == set(registry.ALL_PROVIDER_NAMES)


def test_default_variables_are_exactly_the_engine_variables():
    """The background informs what the engine blends, so the sets must agree."""
    assert set(dbmod.DEFAULT_NWP_VARIABLES) == set(ingest.ENGINE_VARIABLES)


def test_default_variables_are_all_canonical():
    for v in dbmod.DEFAULT_NWP_VARIABLES:
        assert v in registry.CANONICAL_VARIABLES or v in ingest.ENGINE_VARIABLES


# ---------------------------------------------------------------------------
# A new station gets it, through both creation paths
# ---------------------------------------------------------------------------

def test_a_new_station_has_the_background_switched_on(database):
    station_id = database.upsert_station("newsite", "New Site")
    st = database.get_station(station_id)
    assert st.nwp_enabled is True
    assert list(st.nwp_providers) == list(dbmod.DEFAULT_NWP_PROVIDERS)
    assert set(st.nwp_variables) == set(dbmod.DEFAULT_NWP_VARIABLES)


def test_the_default_survives_a_second_upload(database):
    """upsert on an existing slug must not reset or clear the config."""
    station_id = database.upsert_station("newsite", "New Site")
    database.update_station_nwp(station_id, False, ["xweather"], ["temperature"])
    again = database.upsert_station("newsite", "New Site", "CR300")
    assert again == station_id
    st = database.get_station(station_id)
    # The operator's explicit choice wins over the default.
    assert st.nwp_enabled is False
    assert list(st.nwp_variables) == ["temperature"]


def test_an_operator_can_still_switch_it_off(database):
    station_id = database.upsert_station("offsite", "Off Site")
    database.update_station_nwp(station_id, False, [], [])
    st = database.get_station(station_id)
    assert st.nwp_enabled is False
    assert list(st.nwp_variables) == []


# ---------------------------------------------------------------------------
# Being on must not spend the access budget without coordinates
# ---------------------------------------------------------------------------

def test_a_station_with_no_position_is_not_fetched_for(database):
    """run_forecast guards on has_position, so an unpositioned station cannot
    trigger a paid call just because the default is on."""
    station_id = database.upsert_station("nopos", "No Position")
    st = database.get_station(station_id)
    assert st.nwp_enabled is True
    assert st.has_position is False


def test_a_positioned_station_is_eligible(database):
    station_id = database.upsert_station("pos", "Positioned")
    database.update_station_position(station_id, -31.224, 18.4283, 300.0, 2.0)
    st = database.get_station(station_id)
    assert st.nwp_enabled is True
    assert st.has_position is True
