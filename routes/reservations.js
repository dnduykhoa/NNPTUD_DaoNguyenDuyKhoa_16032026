var express = require('express');
var router = express.Router();
let mongoose = require('mongoose');
let { checkLogin } = require('../utils/authHandler.js');
let reservationModel = require('../schemas/reservations');
let cartModel = require('../schemas/cart');
let inventoryModel = require('../schemas/inventories');
let productModel = require('../schemas/products');

// get all reservations of current user
router.get('/', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservations = await reservationModel.find({ user: userId }).populate({
            path: 'items.product',
            select: 'title price'
        });
        res.send(reservations);
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

// get 1 reservation of current user by id
router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservation = await reservationModel.findOne({
            _id: req.params.id,
            user: userId
        }).populate({
            path: 'items.product',
            select: 'title price'
        });
        if (!reservation) {
            return res.status(404).send({ message: 'Reservation not found' });
        }
        res.send(reservation);
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

// reserveACart - reserve all items from user's cart (transaction)
router.post('/reserveACart', checkLogin, async function (req, res, next) {
    let session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;

        let cart = await cartModel.findOne({ user: userId }).session(session);
        if (!cart || cart.items.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: 'Cart is empty' });
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of cart.items) {
            let product = await productModel.findById(item.product).session(session);
            if (!product) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).send({ message: `Product ${item.product} not found` });
            }

            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (!inventory || inventory.stock < item.quantity) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).send({ message: `Product ${product.title} is out of stock` });
            }

            inventory.stock -= item.quantity;
            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let subtotal = product.price * item.quantity;
            totalAmount += subtotal;

            reservationItems.push({
                product: item.product,
                quantity: item.quantity,
                price: product.price,
                subtotal: subtotal
            });
        }

        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: 'actived',
            ExpiredAt: new Date(Date.now() + 15 * 60 * 1000) // 15 phút
        });
        await newReservation.save({ session });

        cart.items = [];
        await cart.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.send(newReservation);
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).send({ message: err.message });
    }
});

// reserveItems - reserve from a list of {product, quantity} (transaction)
router.post('/reserveItems', checkLogin, async function (req, res, next) {
    let session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let { items } = req.body; // items: [{product, quantity}, ...]

        if (!items || items.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: 'Items list is empty' });
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of items) {
            let product = await productModel.findById(item.product).session(session);
            if (!product) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).send({ message: `Product ${item.product} not found` });
            }

            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (!inventory || inventory.stock < item.quantity) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).send({ message: `Product ${product.title} is out of stock` });
            }

            inventory.stock -= item.quantity;
            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let subtotal = product.price * item.quantity;
            totalAmount += subtotal;

            reservationItems.push({
                product: item.product,
                quantity: item.quantity,
                price: product.price,
                subtotal: subtotal
            });
        }

        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: 'actived',
            ExpiredAt: new Date(Date.now() + 15 * 60 * 1000) // 15 phút
        });
        await newReservation.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.send(newReservation);
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).send({ message: err.message });
    }
});

// cancelReserve - cancel a reservation by id (no transaction required)
router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservation = await reservationModel.findOne({
            _id: req.params.id,
            user: userId
        });

        if (!reservation) {
            return res.status(404).send({ message: 'Reservation not found' });
        }

        if (reservation.status !== 'actived') {
            return res.status(400).send({ message: `Cannot cancel a reservation with status: ${reservation.status}` });
        }

        for (let item of reservation.items) {
            let inventory = await inventoryModel.findOne({ product: item.product });
            if (inventory) {
                inventory.stock += item.quantity;
                inventory.reserved -= item.quantity;
                await inventory.save();
            }
        }

        reservation.status = 'cancelled';
        await reservation.save();

        res.send(reservation);
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

module.exports = router;
