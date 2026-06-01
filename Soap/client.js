const soap = require("soap");

soap.createClient("http://localhost:8000/products?wsdl", {}, function (err, client) {
  if (err) {
    console.error("Error creating SOAP client:", err);
    return;
  }
  // CreateProduct
  client.CreateProduct(
    { name: "My product", about: "A test product", price: "99.99" },
    function (err, created) {
      if (err) {
        console.error("Error making SOAP request:", err);
        return;
      }
      console.log("[CreateProduct] Result:", created);
      const createdId = created.id;

      // PatchProduct (update price only)
      client.PatchProduct({ id: createdId, price: "49.99" }, function (err, patched) {
        if (err) {
          console.error("[PatchProduct] Error:", err);
          return;
        }
        console.log("[PatchProduct] Result:", patched);

        // DeleteProduct (delete by id)
        client.DeleteProduct({ id: createdId }, function (err, deleted) {
          if (err) {
            console.error("[DeleteProduct] Error:", err);
            return;
          }
          console.log("[DeleteProduct] Result:", deleted);
        });
      });
    }
  );
});
