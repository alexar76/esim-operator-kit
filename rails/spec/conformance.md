# Check an existing eSIM seller

Use Node.js 20 or newer. Run the checker from a source checkout:

```sh
node rails/bin/esim-rails-check.mjs https://esim.example.com/agents --country FR
```

Choose a country where the seller has offers. The report checks the listing, quote schema and signature, order price challenge, status handling with a synthetic ID and the advertised refund route. The order request carries no payment authorization. The checker never submits a refund. A successful run verifies these parts of the contract. It does not verify delivery or the settlement of a refund.

## Share the checker with an operator

From the operator kit root, build the small npm archive in the current directory:

```sh
npm --prefix rails run pack:check -- "$PWD"
```

In the directory containing the archive, install it into a clean npm project and run the checker:

```sh
npm install --offline ./aimarket-esim-rails-check-*.tgz
./node_modules/.bin/esim-rails-check https://esim.example.com/agents --country FR
```

The archive includes the JSON Schemas in `spec/esim-v1`. Installation requires no registry access or seller runtime.
