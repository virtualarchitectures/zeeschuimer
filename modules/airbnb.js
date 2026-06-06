zeeschuimer.register_module(
  "Airbnb.ie",
  "airbnb.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["airbnb.ie"].includes(domain)) return [];

    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
      return [];
    }

    // StaysSearch GraphQL response:
    //   data.presentation.staysSearch.results.searchResults[]  (standard list view)
    //   data.presentation.staysSearch.mapResults.mapSearchResults[]  (map view)
    const staysSearch = data?.data?.presentation?.staysSearch;
    if (!staysSearch) return [];

    const searchResults = staysSearch?.results?.searchResults ?? [];
    const mapResults = staysSearch?.mapResults?.mapSearchResults ?? [];
    const results = searchResults.length > 0 ? searchResults : mapResults;

    if (!results.length) return [];

    return results
      .map((result) => {
        // Listing ID is a base64-encoded global ID: "StayListing:12345678"
        const raw_id = result?.demandStayListing?.id ?? null;
        let id = null;
        if (raw_id) {
          try {
            const decoded = atob(raw_id);
            const match = decoded.match(/StayListing:(\d+)/);
            id = match ? match[1] : raw_id;
          } catch (e) {
            id = raw_id;
          }
        }
        if (!id) return null;

        return {
          id,
          name: result?.demandStayListing?.description?.name
            ?.localizedStringWithTranslationPreference ?? null,
          latitude:
            result?.demandStayListing?.location?.coordinate?.latitude ?? null,
          longitude:
            result?.demandStayListing?.location?.coordinate?.longitude ?? null,
          price_primary:
            result?.structuredDisplayPrice?.primaryLine?.price ?? null,
          price_secondary:
            result?.structuredDisplayPrice?.secondaryLine?.price ?? null,
          image_url: result?.contextualPictures?.[0]?.picture ?? null,
          avg_rating: result?.demandStayListing?.avgRating ?? null,
          reviews_count: result?.demandStayListing?.reviewsCount ?? null,
          is_superhost: result?.demandStayListing?.isSuperhost ?? null,
        };
      })
      .filter((item) => item !== null);
  }
);
